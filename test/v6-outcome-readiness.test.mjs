import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { runDaily } from '../src/app.mjs';
import { deriveReportOutcome } from '../src/outcome.mjs';
import { evaluateReadiness, verifyPersistedRun } from '../src/readiness.mjs';
import { createRunReceipt, finalizeRunReceipt, readLatestRunReceipt } from '../src/run-receipt.mjs';
import { validateReport } from '../src/schema.mjs';
import { persistReport, readLatestReport } from '../src/storage.mjs';
import { sha256, stableStringify } from '../src/util.mjs';
import { fixtureConfig, fixtureReport, temporaryDirectory } from './helpers.mjs';

test('v2 report writes structured outcome while immutable v1 reports remain readable', async (t) => {
  const root = await temporaryDirectory();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const report = await fixtureReport(root);
  assert.equal(report.schemaVersion, 'designsignal.daily.v2');
  assert.equal(report.outcome.status, 'completed_with_gaps');
  assert.deepEqual(report.outcome.gaps.map((gap) => gap.code), ['authoritative_model_incomplete']);
  assert.deepEqual(validateReport(report), []);

  const legacyRoot = `${root}-legacy`;
  t.after(() => fs.rm(legacyRoot, { recursive: true, force: true }));
  const legacy = structuredClone(report);
  legacy.schemaVersion = 'designsignal.daily.v1';
  delete legacy.outcome;
  legacy.integrity.contentSha256 = null;
  legacy.integrity.contentSha256 = sha256(stableStringify(legacy));
  assert.deepEqual(validateReport(legacy), []);
  await persistReport(legacyRoot, legacy);
  const restored = await readLatestReport(legacyRoot);
  assert.equal(restored.schemaVersion, 'designsignal.daily.v1');
  assert.equal('outcome' in restored, false);
});

test('outcome is completed only for exact quota, verified visuals, authoritative model, and required sources', async (t) => {
  const root = await temporaryDirectory();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const report = await fixtureReport(root);
  const authoritative = report.items.map((item) => ({
    ...item,
    analysis: { model: { ...item.analysis.model, status: 'completed', authoritative: true } }
  }));
  const completed = deriveReportOutcome({
    selection: report.selection,
    analyses: authoritative,
    sourceHealth: report.sourceHealth,
    evaluatedAt: report.generatedAt
  });
  assert.equal(completed.status, 'completed');
  assert.deepEqual(completed.gaps, []);

  const shortage = deriveReportOutcome({
    selection: { ...report.selection, counts: { ...report.selection.counts, ui: 0 } },
    analyses: authoritative.filter((item) => item.category !== 'ui'),
    sourceHealth: report.sourceHealth.map((item, index) =>
      index === 0 ? { ...item, status: 'degraded', required: true } : item
    ),
    evaluatedAt: report.generatedAt
  });
  assert.equal(shortage.status, 'completed_with_gaps');
  assert.equal(shortage.gaps.some((gap) => gap.code === 'quota_shortage' && gap.scope === 'content.ui'), true);
  assert.equal(shortage.gaps.some((gap) => gap.code === 'visual_evidence_incomplete'), true);
  assert.equal(shortage.gaps.some((gap) => gap.code === 'required_source_degraded'), true);
});

test('authoritative fixture replay persists a complete run receipt and passes required Feishu verification', async (t) => {
  const root = await temporaryDirectory();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const apiKey = ['runtime', 'model', 'credential'].join('-');
  const webhook = 'https://hooks.example.com/feishu-v6-fixture';
  const config = {
    ...fixtureConfig(root, {
      dryRun: false,
      model: 'fixture-authoritative-model',
      baseUrl: 'https://model.example.com/v1',
      requiredChannel: 'feishu'
    }),
    apiKey,
    allowedHosts: ['model.example.com', 'hooks.example.com']
  };
  const result = await runDaily(config, {
    environment: { DESIGNSIGNAL_PUSH_CHANNELS: 'feishu', FEISHU_WEBHOOK_URL: webhook },
    transport: authoritativeTransport
  });
  assert.equal(result.report.outcome.status, 'completed');
  assert.equal(result.readiness.status, 'completed');
  assert.equal(result.receipt.status, 'completed');
  assert.deepEqual(result.receipt.stages.map((stage) => stage.name), [
    'collect',
    'select',
    'analyze',
    'synthesize',
    'persist',
    'deliver',
    'verify'
  ]);
  assert.equal(result.receipt.stages.every((stage) => stage.status === 'completed'), true);
  assert.equal(result.receipt.report.ref, `reports/${result.report.date}/report.json`);
  const serialized = JSON.stringify(result.receipt);
  assert.equal(serialized.includes(root), false);
  assert.equal(serialized.includes(apiKey), false);
  assert.equal(serialized.includes(webhook), false);

  const verified = await verifyPersistedRun(root, { date: result.report.date, requireChannel: 'feishu' });
  assert.equal(verified.status, 'completed');
  assert.equal(verified.checks.delivery.sent, 1);
  assert.equal(verified.persistedFiles.files.length, 3);
  assert.equal(verified.persistedFiles.files.every((file) => file.status === 'completed'), true);
});

test('invalid report synthesis records a failed safe receipt without absolute paths', async (t) => {
  const root = await temporaryDirectory();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = {
    ...fixtureConfig(root, { dryRun: false, noPush: true }),
    mode: 'live',
    model: null,
    apiKey: null,
    allowedHosts: ['feed.example.com']
  };
  await assert.rejects(
    runDaily(config, {
      sources: [
        {
          id: 'required-empty',
          kind: 'rss',
          adapter: 'rss',
          category: 'frontier',
          name: 'Required empty source',
          url: 'https://feed.example.com/rss',
          required: true
        }
      ],
      transport: async () => {
        const error = new Error('request_timeout');
        error.code = 'request_timeout';
        throw error;
      },
      now: () => new Date('2026-08-31T15:50:00.000Z')
    }),
    { code: 'report_schema_invalid' }
  );
  const receipt = await readLatestRunReceipt(root);
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.error.code, 'report_schema_invalid');
  assert.equal(JSON.stringify(receipt).includes(root), false);
});

test('readiness filters delivery to the report date and freezes an over-budget run', async (t) => {
  const root = await temporaryDirectory();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const report = await fixtureReport(root);
  const receipt = createRunReceipt({
    date: report.date,
    mode: 'live',
    startedAt: '2026-08-31T00:00:00.000Z',
    deadlineMs: 20 * 60 * 1000
  });
  for (const stage of receipt.stages) stage.status = 'completed';
  finalizeRunReceipt(receipt, { status: 'completed_with_gaps', completedAt: '2026-08-31T00:21:00.000Z' });
  const readiness = evaluateReadiness({
    report,
    outbox: {
      messages: [
        { reportDate: report.date, channel: 'feishu', status: 'sent' },
        { reportDate: '2026-08-30', channel: 'feishu', status: 'sent' }
      ]
    },
    runReceipt: receipt,
    requireChannel: 'feishu',
    deadlineMs: 20 * 60 * 1000
  });
  assert.equal(readiness.checks.delivery.sent, 1);
  assert.equal(readiness.checks.delivery.status, 'completed');
  assert.equal(readiness.checks.slo.status, 'completed_with_gaps');
  assert.equal(readiness.gaps.some((gap) => gap.code === 'run_slo_not_verified'), true);
});

async function authoritativeTransport(url) {
  if (url.endsWith('/responses'))
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      bytes: Buffer.from(
        JSON.stringify({
          id: 'resp_v6_fixture',
          output_text: JSON.stringify({
            title: { zh: '权威模型标题', en: 'Authoritative model title' },
            summary: { zh: '权威模型摘要', en: 'Authoritative model summary' },
            evidence: { zh: '仅使用给定证据。', en: 'Uses only supplied evidence.' },
            method: { zh: '保留方法边界。', en: 'Preserves method boundaries.' },
            novelty: { zh: '结构化新意。', en: 'Structured novelty.' },
            limits: { zh: '保留公开来源局限。', en: 'Retains public-source limits.' },
            whyLearn: { zh: '训练证据判断。', en: 'Trains evidence judgment.' },
            studyAction: { zh: '记录反证和指标。', en: 'Record counterevidence and metrics.' },
            mappings: [],
            confidence: 0.81
          })
        })
      )
    };
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    bytes: Buffer.from(JSON.stringify({ code: 0, msg: 'success' }))
  };
}
