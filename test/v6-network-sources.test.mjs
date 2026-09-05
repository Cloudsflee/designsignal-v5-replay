import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parseListingLinks } from '../src/parsers.mjs';
import { requestBytes, selectPinnedAddress } from '../src/security.mjs';
import { collectLive, DEFAULT_SOURCE_CATALOG, normalizeSourceDefinitions } from '../src/sources.mjs';
import { fixtureConfig, temporaryDirectory } from './helpers.mjs';

const fixtures = path.resolve('test', 'fixtures', 'source-structures');

test('sources.v2 declares fixed redundant groups and bounded detail behavior', () => {
  assert.equal(DEFAULT_SOURCE_CATALOG.schemaVersion, 'designsignal.sources.v2');
  const sources = normalizeSourceDefinitions(DEFAULT_SOURCE_CATALOG);
  assert.equal(sources.length, 14);
  assert.deepEqual(
    Object.fromEntries(
      ['paper', 'product', 'ui', 'frontier'].map((category) => [category, sources.filter((source) => source.category === category).length])
    ),
    { paper: 2, product: 3, ui: 3, frontier: 6 }
  );
  assert.equal(sources.every((source) => source.maxDetailPages >= 0 && source.maxDetailPages <= 10), true);
  assert.equal(sources.filter((source) => source.required).map((source) => source.id).sort().join(','),
    'awwwards-ui,core77-product,openai-research,openalex-design-hci');
  assert.equal(sources.filter((source) => ['product', 'ui'].includes(source.category)).every((source) => source.visualEvidenceRequired), true);
});

test('sanitized RSS, Atom, listing, detail, and visual fixtures remain parser-realistic and bounded', async () => {
  const listing = await fs.readFile(path.join(fixtures, 'listing.html'), 'utf8');
  const links = parseListingLinks(listing, { baseUrl: 'https://publisher.example.org/listing', maximum: 1 });
  assert.deepEqual(links, ['https://publisher.example.org/story/repairable-interface']);
  const manifest = JSON.parse(await fs.readFile(path.join(fixtures, 'manifest.json'), 'utf8'));
  assert.equal(manifest.sanitized, true);
  for (const fixture of manifest.fixtures) await fs.access(path.join(fixtures, fixture.path));
  const image = await fs.readFile(path.join(fixtures, 'visual.png'));
  assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});

test('listing adapter fetches at most its detail limit and localizes verified visual evidence', async (t) => {
  const root = await temporaryDirectory();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const listing = await fs.readFile(path.join(fixtures, 'listing.html'));
  const detail = await fs.readFile(path.join(fixtures, 'detail.html'));
  const visual = await fs.readFile(path.join(fixtures, 'visual.png'));
  const calls = [];
  const result = await collectLive(
    { ...fixtureConfig(root), mode: 'live', allowedHosts: ['publisher.example.org'] },
    {
      date: '2026-08-31',
      sources: [
        {
          id: 'publisher-product',
          kind: 'page',
          adapter: 'listing',
          category: 'product',
          name: 'Publisher product',
          institution: 'Fixture publisher',
          url: 'https://publisher.example.org/listing',
          required: true,
          maxDetailPages: 1,
          visualEvidenceRequired: true
        }
      ],
      transport: async (url) => {
        calls.push(url);
        if (url.endsWith('listing')) return response(listing, 'text/html', url);
        if (url.endsWith('visual.png')) return response(visual, 'image/png', url);
        return response(detail, 'text/html', url);
      },
      cacheWriter: async ({ bytes }) => ({ blobRef: `cache/blobs/${bytes.length}` }),
      now: () => new Date('2026-08-31T15:50:00.000Z')
    }
  );
  assert.deepEqual(calls, [
    'https://publisher.example.org/listing',
    'https://publisher.example.org/story/repairable-interface',
    'https://publisher.example.org/media/visual.png'
  ]);
  assert.equal(result.candidates.length, 1);
  assert.match(result.candidates[0].image.url, /^\/api\/media\/[a-f0-9]{64}$/);
  assert.equal(result.candidates[0].image.verified, true);
  assert.equal(result.sourceHealth[0].status, 'healthy');
  assert.equal(result.sourceHealth[0].required, true);
});

test('required source changes degrade only that source and never fabricate a candidate', async () => {
  const config = { ...fixtureConfig(await temporaryDirectory()), mode: 'live' };
  const result = await collectLive(config, {
    date: '2026-08-31',
    sources: [
      {
        id: 'changed-required-source',
        kind: 'rss',
        adapter: 'rss',
        category: 'frontier',
        name: 'Changed required source',
        url: 'https://feed.example.com/rss',
        required: true
      }
    ],
    transport: async () => {
      const error = new Error('parser_shape_changed');
      error.code = 'parser_shape_changed';
      throw error;
    },
    now: () => new Date('2026-08-31T15:50:00.000Z')
  });
  assert.equal(result.candidates.length, 0);
  assert.equal(result.sourceHealth[0].status, 'degraded');
  assert.equal(result.sourceHealth[0].required, true);
  assert.equal(result.rejected[0].detail, 'parser_shape_changed');
});

test('GET rotates pinned public addresses and retries only explicit statuses or 5xx', async () => {
  const addresses = [
    { address: '8.8.8.8', family: 4 },
    { address: '1.1.1.1', family: 4 }
  ];
  const selected = [];
  let calls = 0;
  const result = await requestBytes('https://example.com/resource', {
    allowedHosts: ['example.com'],
    resolver: async () => addresses,
    retries: 2,
    requester: async (target, options) => {
      calls += 1;
      selected.push(selectPinnedAddress(target.addresses, options.addressOffset).address);
      return {
        status: calls === 1 ? 503 : 200,
        headers: { 'retry-after': '0' },
        bytes: Buffer.from('ok'),
        dnsAddress: selected.at(-1)
      };
    }
  });
  assert.equal(result.status, 200);
  assert.equal(result.attempts, 2);
  assert.deepEqual(selected, ['8.8.8.8', '1.1.1.1']);

  calls = 0;
  const notFound = await requestBytes('https://example.com/missing', {
    allowedHosts: ['example.com'],
    resolver: async () => addresses,
    retries: 3,
    requester: async () => {
      calls += 1;
      return { status: 404, headers: {}, bytes: Buffer.alloc(0), dnsAddress: '8.8.8.8' };
    }
  });
  assert.equal(notFound.status, 404);
  assert.equal(calls, 1);
});

test('non-idempotent POST never receives transport-layer automatic replay', async () => {
  let calls = 0;
  await assert.rejects(
    requestBytes('https://example.com/side-effect', {
      allowedHosts: ['example.com'],
      resolver: async () => [{ address: '8.8.8.8', family: 4 }],
      retries: 5,
      method: 'POST',
      body: '{}',
      requester: async () => {
        calls += 1;
        const error = new Error('connection_reset');
        error.code = 'ECONNRESET';
        throw error;
      }
    }),
    { code: 'ECONNRESET' }
  );
  assert.equal(calls, 1);
});

function response(bytes, contentType, url) {
  return { status: 200, headers: { 'content-type': contentType }, bytes, url, attempts: 1, dnsAddress: '8.8.8.8' };
}
