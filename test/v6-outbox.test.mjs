import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  enqueueReportDeliveries,
  outboxStatus,
  processOutbox,
  reconcileOutbox,
  renderFeishuDocumentBlocks
} from '../src/outbox.mjs';
import { persistReport } from '../src/storage.mjs';
import { sha256, stableStringify } from '../src/util.mjs';
import { fixtureReport, temporaryDirectory } from './helpers.mjs';

test('outbox.v2 covers four channels with safe projections and no endpoint values', async (t) => {
  const root = await temporaryDirectory();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const report = await fixtureReport(root);
  const webhookValues = {
    DESIGNSIGNAL_PUSH_CHANNELS: 'generic,feishu,wecom,feishu-document',
    DESIGNSIGNAL_WEBHOOK_URL: 'https://hooks.example.com/generic-v6-secret',
    FEISHU_WEBHOOK_URL: 'https://hooks.example.com/feishu-v6-secret',
    WECOM_WEBHOOK_URL: 'https://hooks.example.com/wecom-v6-secret',
    FEISHU_APP_ID: 'app_fixture',
    FEISHU_APP_SECRET: 'app-secret-v6',
    FEISHU_DOC_FOLDER_TOKEN: 'folder-token-v6'
  };
  const messages = await enqueueReportDeliveries(root, report, webhookValues);
  assert.equal(messages.length, 4);
  assert.equal(messages.every((message) => message.schemaVersion === 'designsignal.outbox.v2'), true);
  const calls = [];
  const transport = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/auth/v3/tenant_access_token'))
      return jsonResponse({ code: 0, tenant_access_token: 'runtime-tenant-token' });
    if (url.endsWith('/documents'))
      return jsonResponse({ code: 0, data: { document: { document_id: 'doc_fixture_1', revision_id: 1 } } });
    if (url.includes('/children?')) return jsonResponse({ code: 0, data: { document_revision_id: 2 } });
    if (url.includes('wecom')) return jsonResponse({ errcode: 0 });
    if (url.includes('feishu')) return jsonResponse({ code: 0 });
    return { status: 204, headers: {}, bytes: Buffer.alloc(0) };
  };
  await processOutbox(root, { environment: webhookValues, transport, now: () => new Date('2026-08-31T16:00:00.000Z') });
  const status = await outboxStatus(root, { environment: webhookValues });
  assert.equal(status.total, 4);
  assert.equal(status.sent, 4);
  assert.equal(status.pending, 0);
  assert.equal(status.failed, 0);
  assert.equal(status.reconcileRequired, 0);
  assert.equal(calls.some((call) => call.url.includes('/children?')), true);
  const raw = (await Promise.all((await fs.readdir(path.join(root, 'outbox'))).map((name) => fs.readFile(path.join(root, 'outbox', name), 'utf8')))).join('\n');
  for (const secret of ['generic-v6-secret', 'feishu-v6-secret', 'wecom-v6-secret', 'app-secret-v6', 'folder-token-v6', 'runtime-tenant-token'])
    assert.equal(raw.includes(secret), false);
  assert.equal(status.messages.every((message) => !('payload' in message) && !('endpoint' in message)), true);
});

test('outbox restart detects an unconfirmed dispatch and refuses automatic replay', async (t) => {
  const root = await temporaryDirectory();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const report = await fixtureReport(root);
  const environment = { DESIGNSIGNAL_PUSH_CHANNELS: 'generic', DESIGNSIGNAL_WEBHOOK_URL: 'https://hooks.example.com/restart' };
  await enqueueReportDeliveries(root, report, environment);
  const file = path.join(root, 'outbox', (await fs.readdir(path.join(root, 'outbox')))[0]);
  const message = JSON.parse(await fs.readFile(file, 'utf8'));
  message.status = 'dispatching';
  message.dispatch = { phase: 'webhook', startedAt: message.updatedAt, taskHash: message.taskHash };
  await fs.writeFile(file, `${JSON.stringify(message, null, 2)}\n`);
  let calls = 0;
  await processOutbox(root, {
    environment,
    transport: async () => {
      calls += 1;
      return { status: 204, headers: {}, bytes: Buffer.alloc(0) };
    },
    now: () => new Date('2026-08-31T16:00:00.000Z')
  });
  const state = (await outboxStatus(root)).messages[0];
  assert.equal(state.status, 'reconcile_required');
  assert.equal(state.errorCode, 'dispatch_interrupted');
  assert.equal(calls, 0);
});

test('concurrent outbox workers use an atomic per-message lock', async (t) => {
  const root = await temporaryDirectory();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const report = await fixtureReport(root);
  const environment = { DESIGNSIGNAL_PUSH_CHANNELS: 'generic', DESIGNSIGNAL_WEBHOOK_URL: 'https://hooks.example.com/concurrent' };
  await enqueueReportDeliveries(root, report, environment);
  let calls = 0;
  const transport = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { status: 204, headers: {}, bytes: Buffer.alloc(0) };
  };
  await Promise.all([
    processOutbox(root, { environment, transport, now: () => new Date('2026-08-31T16:00:00.000Z') }),
    processOutbox(root, { environment, transport, now: () => new Date('2026-08-31T16:00:00.000Z') })
  ]);
  assert.equal(calls, 1);
  assert.equal((await outboxStatus(root)).sent, 1);
});

test('Feishu document writes ordered chunks of at most fifty blocks and resumes from cursor', async (t) => {
  const root = await temporaryDirectory();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const report = largeReport();
  const environment = {
    DESIGNSIGNAL_PUSH_CHANNELS: 'feishu-document',
    FEISHU_APP_ID: 'app_fixture',
    FEISHU_APP_SECRET: 'doc-secret',
    FEISHU_DOC_FOLDER_TOKEN: 'folder-token'
  };
  await enqueueReportDeliveries(root, report, environment);
  const chunks = [];
  let revision = 1;
  const transport = async (url, options) => {
    if (url.includes('/auth/v3/tenant_access_token')) return jsonResponse({ code: 0, tenant_access_token: 'token' });
    if (url.endsWith('/documents')) return jsonResponse({ code: 0, data: { document: { document_id: 'doc_chunks_1', revision_id: revision } } });
    if (url.includes('/children?')) {
      const body = JSON.parse(options.body);
      chunks.push({ index: body.index, size: body.children.length });
      revision += 1;
      return jsonResponse({ code: 0, data: { document_revision_id: revision } });
    }
    throw new Error('unexpected_document_url');
  };
  await processOutbox(root, { environment, transport, now: () => new Date('2026-08-31T16:00:00.000Z') });
  assert.equal(chunks.length > 2, true);
  assert.equal(chunks.every((chunk) => chunk.size >= 1 && chunk.size <= 50), true);
  assert.deepEqual(chunks.map((chunk) => chunk.index), [...chunks].sort((left, right) => left.index - right.index).map((chunk) => chunk.index));
  const status = await outboxStatus(root);
  assert.equal(status.sent, 1);
  const file = path.join(root, 'outbox', (await fs.readdir(path.join(root, 'outbox')))[0]);
  const stored = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(stored.document.cursor, stored.document.totalBlocks);
  assert.equal(stored.document.confirmedBlocks, stored.document.totalBlocks);
});

test('ambiguous webhook can only continue after hash-checked manual reconciliation', async (t) => {
  const root = await temporaryDirectory();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const report = await fixtureReport(root);
  await persistReport(root, report);
  const environment = { DESIGNSIGNAL_PUSH_CHANNELS: 'generic', DESIGNSIGNAL_WEBHOOK_URL: 'https://hooks.example.com/ambiguous' };
  await enqueueReportDeliveries(root, report, environment);
  await processOutbox(root, {
    environment,
    transport: async () => {
      const error = new Error('connection_reset_after_send');
      error.code = 'ECONNRESET';
      throw error;
    },
    now: () => new Date('2026-08-31T16:00:00.000Z')
  });
  const before = (await outboxStatus(root)).messages[0];
  assert.equal(before.status, 'reconcile_required');
  const reconciled = await reconcileOutbox(root, { id: before.id, observed: 'absent', confirm: true }, { environment, now: () => new Date('2026-08-31T16:01:00.000Z') });
  assert.equal(reconciled.status, 'pending');
  await processOutbox(root, {
    environment,
    transport: async () => ({ status: 204, headers: {}, bytes: Buffer.alloc(0) }),
    now: () => new Date('2026-08-31T16:02:00.000Z')
  });
  assert.equal((await outboxStatus(root)).sent, 1);
});

test('explicit 429 enters retry_wait while malformed success and transport interruption do not replay', async (t) => {
  const root = await temporaryDirectory();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const report = await fixtureReport(root);
  const environment = { DESIGNSIGNAL_PUSH_CHANNELS: 'generic', DESIGNSIGNAL_WEBHOOK_URL: 'https://hooks.example.com/rate-limit' };
  await enqueueReportDeliveries(root, report, environment);
  let calls = 0;
  await processOutbox(root, {
    environment,
    transport: async () => {
      calls += 1;
      return { status: 429, headers: { 'retry-after': '1' }, bytes: Buffer.from('rate limited') };
    },
    now: () => new Date('2026-08-31T16:00:00.000Z')
  });
  const state = (await outboxStatus(root)).messages[0];
  assert.equal(state.status, 'retry_wait');
  assert.equal(state.attempts, 1);
  assert.equal(calls, 1);
  await processOutbox(root, {
    environment,
    transport: async () => {
      calls += 1;
      return { status: 204, headers: {}, bytes: Buffer.alloc(0) };
    },
    now: () => new Date('2026-08-31T16:00:01.000Z')
  });
  assert.equal(calls, 1);
});

test('historical webhook v1 remains processable without silent schema conversion', async (t) => {
  const root = await temporaryDirectory();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'outbox');
  await fs.mkdir(directory, { recursive: true });
  const legacy = {
    schemaVersion: 'designsignal.outbox.v1',
    id: 'legacy-message',
    reportId: 'legacy-report',
    reportDate: '2026-08-31',
    channel: 'generic',
    secretEnv: 'DESIGNSIGNAL_WEBHOOK_URL',
    payload: { event: 'legacy' },
    status: 'pending',
    attempts: 0,
    lastError: null,
    nextAttemptAt: '2026-08-31T15:00:00.000Z',
    createdAt: '2026-08-31T15:00:00.000Z',
    sentAt: null
  };
  await fs.writeFile(path.join(directory, 'legacy.json'), `${JSON.stringify(legacy, null, 2)}\n`);
  const environment = { DESIGNSIGNAL_WEBHOOK_URL: 'https://hooks.example.com/legacy' };
  await processOutbox(root, {
    environment,
    transport: async () => ({ status: 204, headers: {}, bytes: Buffer.alloc(0) }),
    now: () => new Date('2026-08-31T16:00:00.000Z')
  });
  const stored = JSON.parse(await fs.readFile(path.join(directory, 'legacy.json'), 'utf8'));
  assert.equal(stored.schemaVersion, 'designsignal.outbox.v1');
  assert.equal(stored.status, 'sent');
});

test('historical Feishu document v1 completes in its original schema and chunk state', async (t) => {
  const root = await temporaryDirectory();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const report = await fixtureReport(root);
  await persistReport(root, report);
  const blocks = renderFeishuDocumentBlocks(report);
  const directory = path.join(root, 'outbox');
  const legacy = {
    schemaVersion: 1,
    id: 'a'.repeat(24),
    channel: 'feishu-document',
    reportDate: report.date,
    state: 'pending',
    reason: 'queued',
    attempts: 0,
    nextAttemptAt: '2026-08-31T15:00:00.000Z',
    createdAt: '2026-08-31T15:00:00.000Z',
    renderFingerprint: sha256(stableStringify(blocks)),
    totalBlocks: blocks.length,
    nextBlockIndex: 0
  };
  const file = path.join(directory, `${legacy.id}.json`);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(legacy, null, 2)}\n`);
  const environment = {
    FEISHU_APP_ID: 'legacy-app',
    FEISHU_APP_SECRET: 'legacy-secret',
    FEISHU_DOC_FOLDER_TOKEN: 'legacy-folder'
  };
  let revision = 4;
  await processOutbox(root, {
    environment,
    transport: async (url) => {
      if (url.includes('/auth/v3/tenant_access_token')) return jsonResponse({ code: 0, tenant_access_token: 'legacy-token' });
      if (url.endsWith('/documents'))
        return jsonResponse({ code: 0, data: { document: { document_id: 'legacy_doc_1', revision_id: revision } } });
      revision += 1;
      return jsonResponse({ code: 0, data: { document_revision_id: revision } });
    },
    now: () => new Date('2026-08-31T16:00:00.000Z')
  });
  const stored = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(stored.schemaVersion, 1);
  assert.equal(stored.state, 'delivered');
  assert.equal(stored.nextBlockIndex, stored.totalBlocks);
  assert.equal(stored.documentId, 'legacy_doc_1');
});

function jsonResponse(value) {
  return { status: 200, headers: { 'content-type': 'application/json' }, bytes: Buffer.from(JSON.stringify(value)) };
}

function largeReport() {
  const items = Array.from({ length: 32 }, (_, index) => ({
    category: index % 4 === 0 ? 'paper' : index % 4 === 1 ? 'product' : index % 4 === 2 ? 'ui' : 'frontier',
    title: { zh: `条目 ${index}`, en: `Item ${index}` },
    evidence: { zh: '证据', en: 'Evidence' },
    whyLearn: { zh: '学习', en: 'Learn' },
    studyAction: { zh: '动作', en: 'Action' }
  }));
  return {
    id: 'daily_large_fixture',
    date: '2026-08-31',
    generatedAt: '2026-08-31T15:50:00.000Z',
    integrity: { contentSha256: 'a'.repeat(64) },
    outcome: { status: 'completed_with_gaps' },
    items,
    hypotheses: [],
    coreExercise: { title: { zh: '练习' }, prompt: { zh: '提示' } }
  };
}
