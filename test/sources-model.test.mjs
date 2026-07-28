import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeSignal } from '../src/analyze.mjs';
import { collectSignals, collectLive, downloadOpenAccessPdf } from '../src/sources.mjs';
import { fixtureConfig, temporaryDirectory } from './helpers.mjs';

test('live adapter attaches response hash, MIME, bytes, DNS, access, and license provenance', async () => {
  const config = { ...fixtureConfig(await temporaryDirectory()), mode: 'live' };
  const source = {
    id: 'feed-source',
    kind: 'rss',
    category: 'frontier',
    name: 'Feed Source',
    institution: 'Lab',
    url: 'https://feed.example.com/rss'
  };
  const xml = Buffer.from(`<rss><channel><item><guid>x</guid><title>Agent metric</title><link>https://feed.example.com/x</link><description>Evidence</description><pubDate>Mon, 20 Jul 2026 00:00:00 GMT</pubDate></item></channel></rss>`);
  const result = await collectLive(config, {
    date: '2026-07-28',
    sources: [source],
    transport: async () => ({
      status: 200,
      headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
      bytes: xml,
      dnsAddress: '8.8.8.8',
      attempts: 2
    }),
    now: () => new Date('2026-07-28T15:50:00Z')
  });
  assert.equal(result.candidates.length, 1);
  const item = result.candidates[0];
  assert.match(item.provenance.responseSha256, /^[a-f0-9]{64}$/);
  assert.equal(item.provenance.responseMimeType, 'application/rss+xml');
  assert.equal(item.provenance.responseBytes, xml.length);
  assert.equal(item.provenance.dnsAddress, '8.8.8.8');
  assert.equal(item.provenance.access.status, 'public');
  assert.equal(item.provenance.license.status, 'unknown');
});

test('OA PDF handler rejects closed records and verifies PDF signature', async () => {
  const config = { ...fixtureConfig(await temporaryDirectory()), mode: 'live' };
  await assert.rejects(downloadOpenAccessPdf({ access: { openAccess: false } }, config), { code: 'pdf_open_access_required' });
  const item = { access: { openAccess: true, pdfUrl: 'https://arxiv.org/pdf/example', status: 'open_access' }, license: { status: 'repository_terms' } };
  const result = await downloadOpenAccessPdf(item, config, {
    transport: async () => ({
      status: 200,
      headers: { 'content-type': 'application/pdf' },
      bytes: Buffer.from('%PDF-1.7\nfixture')
    })
  });
  assert.match(result.provenance.sha256, /^[a-f0-9]{64}$/);
  await assert.rejects(
    downloadOpenAccessPdf(item, config, {
      transport: async () => ({ status: 200, headers: { 'content-type': 'text/html' }, bytes: Buffer.from('<html>login</html>') })
    }),
    { code: 'pdf_response_invalid' }
  );
});

test('OpenAI-compatible Responses analysis validates structured output and keeps key memory-only', async () => {
  const config = fixtureConfig(await temporaryDirectory());
  const collection = await collectSignals(config, { date: '2026-07-28' });
  const item = collection.candidates[0];
  const key = 'sk-memory-only-secret123';
  let authorization;
  const output = {
    title: item.title,
    summary: item.abstract,
    evidence: item.evidenceExcerpt,
    method: item.methodHint,
    novelty: { zh: '保留证据边界。', en: 'Preserves evidence boundaries.' },
    limits: { zh: '样本有限。', en: 'The sample is limited.' },
    whyLearn: { zh: '训练证据判断。', en: 'Trains evidence judgment.' },
    studyAction: { zh: '写出反证。', en: 'Write counterevidence.' },
    mappings: item.mappings.map(() => ({ reason: { zh: '直接相关。', en: 'Directly relevant.' } })),
    confidence: 0.73
  };
  const analysis = await analyzeSignal(
    item,
    { ...config, model: 'test-model', apiKey: key, baseUrl: 'https://model.example.com/v1' },
    {
      transport: async (_url, options) => {
        authorization = options.headers.authorization;
        return { status: 200, bytes: Buffer.from(JSON.stringify({ id: 'resp_1', output_text: JSON.stringify(output) })) };
      },
      now: () => new Date('2026-07-28T15:50:00Z')
    }
  );
  assert.equal(authorization, `Bearer ${key}`);
  assert.equal(analysis.analysis.model.status, 'completed');
  assert.equal(JSON.stringify(analysis).includes(key), false);
});

test('model failure falls back with redacted non-authoritative metadata', async () => {
  const config = fixtureConfig(await temporaryDirectory());
  const collection = await collectSignals(config, { date: '2026-07-28' });
  const key = 'sk-fallback-secret123';
  const analysis = await analyzeSignal(collection.candidates[0], { ...config, model: 'test-model', apiKey: key }, {
    transport: async () => {
      throw new Error(`failed ${key}`);
    }
  });
  assert.equal(analysis.analysis.model.status, 'failed_fallback');
  assert.equal(JSON.stringify(analysis).includes(key), false);
  assert.equal(analysis.analysis.model.authoritative, false);
});
