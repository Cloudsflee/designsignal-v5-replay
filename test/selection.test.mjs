import assert from 'node:assert/strict';
import test from 'node:test';
import { collectSignals } from '../src/sources.mjs';
import { selectDailySignals } from '../src/select.mjs';
import { fixtureConfig, temporaryDirectory } from './helpers.mjs';

const date = '2026-07-28';

test('60-day history dedupe excludes prior canonical records without quota fabrication', async () => {
  const root = await temporaryDirectory();
  const collection = await collectSignals(fixtureConfig(root), { date });
  const prior = collection.candidates.find((item) => item.category === 'product');
  const selection = selectDailySignals(collection, { date, history: [{ date: '2026-07-01', items: [prior] }] });
  assert.equal(selection.selected.length, 5);
  assert.equal(selection.complete, false);
  assert.deepEqual(selection.shortages, [{ category: 'product', required: 1, selected: 0, missing: 1 }]);
  assert.equal(selection.rejected.some((item) => item.candidateId === prior.id && item.reason === 'duplicate_60_day_history'), true);
});

test('missing candidates produce explicit shortage rather than quota filler', async () => {
  const root = await temporaryDirectory();
  const collection = await collectSignals(fixtureConfig(root), { date });
  collection.candidates = collection.candidates.filter((item) => item.category !== 'ui');
  const selection = selectDailySignals(collection, { date });
  assert.equal(selection.selected.length, 5);
  assert.equal(selection.counts.ui, 0);
  assert.equal(selection.shortages[0].category, 'ui');
  assert.equal(selection.selected.some((item) => String(item.id).includes('filler')), false);
});

test('product or UI candidates without visual evidence are rejected', async () => {
  const root = await temporaryDirectory();
  const collection = await collectSignals(fixtureConfig(root), { date });
  const product = collection.candidates.find((item) => item.category === 'product');
  product.image = null;
  const selection = selectDailySignals(collection, { date });
  assert.equal(selection.counts.product, 0);
  assert.equal(selection.rejected.some((item) => item.candidateId === product.id && item.reason === 'visual_evidence_missing'), true);
});

test('paper quota prefers distinct sources deterministically', async () => {
  const root = await temporaryDirectory();
  const collection = await collectSignals(fixtureConfig(root), { date });
  const papers = collection.candidates.filter((item) => item.category === 'paper');
  const duplicateSource = structuredClone(papers[0]);
  duplicateSource.id = 'paper-same-source-newer';
  duplicateSource.canonicalId = duplicateSource.id;
  duplicateSource.publishedAt = `${date}T14:00:00.000Z`;
  const distinct = structuredClone(papers[1]);
  distinct.id = 'paper-distinct-source';
  distinct.canonicalId = distinct.id;
  distinct.publishedAt = `${date}T00:00:00.000Z`;
  collection.candidates = [papers[0], duplicateSource, distinct, ...collection.candidates.filter((item) => item.category !== 'paper')];
  const first = selectDailySignals(collection, { date });
  const second = selectDailySignals(collection, { date });
  const selectedPapers = first.selected.filter((item) => item.category === 'paper');
  assert.equal(new Set(selectedPapers.map((item) => item.source.id)).size, 2);
  assert.deepEqual(first.selected.map((item) => item.id), second.selected.map((item) => item.id));
});

test('paywalled and login-required records fail closed', async () => {
  const root = await temporaryDirectory();
  const collection = await collectSignals(fixtureConfig(root), { date });
  collection.candidates[0].access.loginRequired = true;
  const selection = selectDailySignals(collection, { date });
  assert.equal(selection.rejected.some((item) => item.reason === 'access_policy_rejected'), true);
});
