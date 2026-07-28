import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { runCollect, runDaily } from '../src/app.mjs';
import { validateReport } from '../src/schema.mjs';
import { fixtureConfig, temporaryDirectory } from './helpers.mjs';

test('offline fixture selects exactly 2 papers, 1 product, 1 UI, and 2 frontier items', async (t) => {
  const root = await temporaryDirectory();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = fixtureConfig(`${root}/never-created`);
  const result = await runCollect(config);
  assert.equal(result.collection.candidates.length, 6);
  assert.deepEqual(result.selection.counts, { paper: 2, product: 1, ui: 1, frontier: 2 });
  assert.equal(result.selection.complete, true);
  assert.equal(new Set(result.selection.selected.map((item) => item.source.id)).size, 6);
});

test('fixture daily dry-run is deterministic and writes no files', async (t) => {
  const root = await temporaryDirectory();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dataDir = `${root}/data`;
  const first = await runDaily(fixtureConfig(dataDir));
  const second = await runDaily(fixtureConfig(dataDir));
  assert.equal(first.report.integrity.contentSha256, second.report.integrity.contentSha256);
  assert.equal(first.persistence, null);
  await assert.rejects(fs.access(dataDir), { code: 'ENOENT' });
});

test('daily report has complete bilingual analysis, provenance, mappings, balanced hypotheses, and exercise', async (t) => {
  const root = await temporaryDirectory();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { report } = await runDaily(fixtureConfig(`${root}/data`));
  assert.deepEqual(validateReport(report), []);
  assert.deepEqual([...new Set(report.items.map((item) => item.language))].sort(), ['en', 'zh']);
  for (const item of report.items) {
    for (const field of ['title', 'summary', 'evidence', 'method', 'novelty', 'limits', 'whyLearn', 'studyAction']) {
      assert.ok(item[field].zh, `${field}.zh`);
      assert.ok(item[field].en, `${field}.en`);
    }
    assert.match(item.citations[0].contentSha256, /^[a-f0-9]{64}$/);
    assert.equal(item.mappings.every((mapping) => mapping.syllabusEdition === 'ZJU-IDI-2027'), true);
  }
  assert.equal(report.hypotheses.length, 3);
  assert.equal(report.hypotheses.every((item) => item.evidence.length && item.counterevidence.length), true);
  assert.equal(report.coreExercise.timeboxMinutes, 150);
  assert.equal(report.coreExercise.rubric.reduce((sum, item) => sum + item.points, 0), 100);
  assert.ok(report.coreExercise.evidenceLinks.length >= 3);
});

test('fixture product and UI entries carry local visual evidence', async (t) => {
  const root = await temporaryDirectory();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { selection } = await runCollect(fixtureConfig(`${root}/data`));
  for (const category of ['product', 'ui']) {
    const item = selection.selected.find((candidate) => candidate.category === category);
    assert.match(item.image.url, /^\/assets\/.+\.png$/);
    assert.equal(item.image.license, 'generated-fixture');
  }
});
