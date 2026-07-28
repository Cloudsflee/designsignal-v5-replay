import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { atomicWrite, persistReport, readLatestReport, withDateLock } from '../src/storage.mjs';
import { fixtureReport, temporaryDirectory } from './helpers.mjs';

test('report persistence atomically writes JSON, Markdown, HTML, latest, and append-only manifest', async (t) => {
  const root = await temporaryDirectory();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const report = await fixtureReport(root);
  const result = await persistReport(root, report);
  assert.equal(result.files.length, 3);
  for (const file of result.files) {
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    await fs.access(path.join(root, file.path));
  }
  assert.equal((await readLatestReport(root)).id, report.id);
  const lines = (await fs.readFile(path.join(root, 'manifest.jsonl'), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).integritySha256, report.integrity.contentSha256);
  const temporaryFiles = (await fs.readdir(path.join(root, 'reports', report.date))).filter((name) => name.endsWith('.tmp'));
  assert.deepEqual(temporaryFiles, []);
  assert.equal((await fs.readdir(path.join(root, 'reports'))).some((name) => name.includes('.stage-')), false);
});

test('date lock rejects a concurrent writer and releases after completion', async (t) => {
  const root = await temporaryDirectory();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let release;
  const first = withDateLock(root, '2026-07-28', () => new Promise((resolve) => (release = resolve)));
  while (!release) await new Promise((resolve) => setTimeout(resolve, 5));
  await assert.rejects(withDateLock(root, '2026-07-28', async () => undefined), { code: 'daily_date_locked' });
  release('done');
  assert.equal(await first, 'done');
  assert.equal(await withDateLock(root, '2026-07-28', async () => 'next'), 'next');
});

test('atomic write can refuse an existing destination', async (t) => {
  const root = await temporaryDirectory();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'immutable.txt');
  await atomicWrite(file, 'first', { overwrite: false });
  await assert.rejects(atomicWrite(file, 'second', { overwrite: false }), { code: 'atomic_destination_exists' });
  assert.equal(await fs.readFile(file, 'utf8'), 'first');
});
