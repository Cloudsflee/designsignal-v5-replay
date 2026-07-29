import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { startServer } from '../src/server.mjs';
import { fixtureConfig, fixtureReport, temporaryDirectory } from './helpers.mjs';

const execFileAsync = promisify(execFile);

test('HTTP server renders escaped dashboard, JSON APIs, health, assets, and security headers', async (t) => {
  const root = await temporaryDirectory();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const report = await fixtureReport(root);
  report.items[0].title.zh = '<script>alert(1)</script>';
  report.items[0].citations[0].url = 'javascript:alert(3)';
  report.items.find((item) => item.category === 'ui').image.url = 'javascript:alert(2)';
  const service = await startServer({ ...fixtureConfig(root), host: '127.0.0.1', port: 0 }, { fallbackReport: report });
  t.after(() => service.close());
  const health = await fetch(`${service.url}/healthz`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ok');
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
  assert.match(health.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const latest = await fetch(`${service.url}/api/reports/latest`);
  const latestText = await latest.text();
  assert.equal(latestText.includes('<script>alert(1)</script>'), false);
  assert.equal(JSON.parse(latestText).items.length, 6);
  const page = await (await fetch(service.url)).text();
  assert.equal(page.includes('<script>alert(1)</script>'), false);
  assert.equal(page.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), true);
  assert.equal(page.includes('javascript:alert'), false);
  assert.match(page, /product-signal\.png/);
  const image = await fetch(`${service.url}/assets/product-signal.png`);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.ok((await image.arrayBuffer()).byteLength > 10_000);
});

test('feedback API validates input and appends a calibration record', async (t) => {
  const root = await temporaryDirectory();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const report = await fixtureReport(root);
  const service = await startServer({ ...fixtureConfig(root), host: '127.0.0.1', port: 0 }, { fallbackReport: report });
  t.after(() => service.close());
  const invalid = await fetch(`${service.url}/api/feedback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rating: 'maybe' })
  });
  assert.equal(invalid.status, 400);
  const accepted = await fetch(`${service.url}/api/feedback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rating: 'useful', note: '<b>keep evidence</b>', reportDate: report.date })
  });
  assert.equal(accepted.status, 201);
  const line = await fs.readFile(path.join(root, 'feedback', `${report.date}.jsonl`), 'utf8');
  assert.equal(JSON.parse(line).note, '<b>keep evidence</b>');
  const invalidJson = await fetch(`${service.url}/api/feedback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{'
  });
  assert.equal(invalidJson.status, 400);
});

test('CLI collect dry-run is offline, exact, and reports zero writes', async () => {
  const root = await temporaryDirectory();
  const executable = path.resolve('bin', 'designsignal.mjs');
  const { stdout, stderr } = await execFileAsync(process.execPath, [executable, 'collect', '--fixture', '--dry-run', '--date', '2026-07-28', '--data-dir', path.join(root, 'data')], {
    cwd: path.resolve('.'),
    timeout: 10_000
  });
  assert.equal(stderr, '');
  const value = JSON.parse(stdout);
  assert.equal(value.selectedCount, 6);
  assert.deepEqual(value.counts, { frontier: 2, paper: 2, product: 1, ui: 1 });
  assert.equal(value.writeCount, 0);
  await assert.rejects(fs.access(path.join(root, 'data')), { code: 'ENOENT' });
});
