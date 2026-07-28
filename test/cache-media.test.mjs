import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { cacheSourceResponse } from '../src/cache.mjs';
import { collectLive } from '../src/sources.mjs';
import { startServer } from '../src/server.mjs';
import { sha256 } from '../src/util.mjs';
import { fixtureConfig, fixtureReport, temporaryDirectory } from './helpers.mjs';

test('content-addressed cache stores immutable blob and append-only provenance metadata', async (t) => {
  const root = await temporaryDirectory();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bytes = Buffer.from('public source body');
  const input = {
    source: { id: 'source-1', kind: 'rss' },
    bytes,
    fetchedAt: '2026-07-28T15:50:00Z',
    mimeType: 'application/rss+xml',
    url: 'https://example.com/feed',
    parsed: [
      {
        id: 'item-1',
        authors: ['Author'],
        source: { institution: 'Lab' },
        access: { status: 'public' },
        license: { status: 'unknown' }
      }
    ]
  };
  const first = await cacheSourceResponse(root, input);
  const second = await cacheSourceResponse(root, input);
  assert.equal(first.sha256, sha256(bytes));
  assert.equal(second.blobRef, first.blobRef);
  assert.equal(await fs.readFile(path.join(root, first.blobRef), 'utf8'), 'public source body');
  const lines = (await fs.readFile(path.join(root, 'cache', 'index.jsonl'), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 2);
  const metadata = JSON.parse(lines[0]);
  assert.deepEqual(metadata.authors, ['Author']);
  assert.deepEqual(metadata.institutions, ['Lab']);
  assert.equal(metadata.access[0].status, 'public');
  assert.equal(metadata.licenses[0].status, 'unknown');
});

test('live product image is validated, cached, and rewritten to same-origin media URL', async (t) => {
  const root = await temporaryDirectory();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const png = await fs.readFile(path.resolve('assets', 'product-signal.png'));
  const source = {
    id: 'product-page',
    kind: 'page',
    category: 'product',
    name: 'Product page',
    institution: 'Studio',
    url: 'https://products.example.com/latest'
  };
  const html = Buffer.from(`<html><head><meta property="og:title" content="Repairable product"><meta property="og:description" content="Public evidence"><meta property="og:url" content="https://products.example.com/item"><meta property="og:image" content="https://products.example.com/image.png"></head></html>`);
  const cacheEntries = [];
  const result = await collectLive(
    { ...fixtureConfig(root), mode: 'live', allowedHosts: ['products.example.com'] },
    {
      date: '2026-07-28',
      sources: [source],
      transport: async (url) =>
        url.endsWith('.png')
          ? { status: 200, headers: { 'content-type': 'image/png' }, bytes: png, url }
          : { status: 200, headers: { 'content-type': 'text/html' }, bytes: html, url },
      cacheWriter: async (entry) => {
        cacheEntries.push(entry);
        return { blobRef: `cache/blobs/${sha256(entry.bytes)}` };
      },
      now: () => new Date('2026-07-28T15:50:00Z')
    }
  );
  assert.equal(cacheEntries.length, 2);
  assert.equal(cacheEntries.some((entry) => entry.source.kind === 'visual'), true);
  assert.equal(result.candidates[0].image.url, `/api/media/${sha256(png)}`);
  assert.equal(result.candidates[0].image.cached, true);
});

test('same-origin media API serves only hash-addressed verified image bytes', async (t) => {
  const root = await temporaryDirectory();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const png = await fs.readFile(path.resolve('assets', 'ui-signal.png'));
  const digest = sha256(png);
  const target = path.join(root, 'cache', 'blobs', digest.slice(0, 2), digest);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, png);
  const service = await startServer({ ...fixtureConfig(root), host: '127.0.0.1', port: 0 }, { fallbackReport: await fixtureReport(root) });
  t.after(() => service.close());
  const response = await fetch(`${service.url}/api/media/${digest}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.from(await response.arrayBuffer()).equals(png), true);
  assert.equal((await fetch(`${service.url}/api/media/not-a-hash`)).status, 404);
});
