import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { enqueueReportDeliveries, outboxStatus, processOutbox } from '../src/outbox.mjs';
import { nextShanghaiRun, scheduleDelay } from '../src/scheduler.mjs';
import { fixtureReport, temporaryDirectory } from './helpers.mjs';

const execFileAsync = promisify(execFile);

test('outbox creates generic, Feishu, and WeCom messages without endpoint values', async (t) => {
  const root = await temporaryDirectory();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const report = await fixtureReport(root);
  const messages = await enqueueReportDeliveries(root, report, {
    DESIGNSIGNAL_PUSH_CHANNELS: 'generic,feishu,wecom,generic',
    DESIGNSIGNAL_WEBHOOK_URL: 'https://hooks.example.com/generic-secret',
    FEISHU_WEBHOOK_URL: 'https://open.feishu.cn/open-apis/bot/v2/hook/feishu-secret',
    WECOM_WEBHOOK_URL: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=wecom-secret'
  });
  assert.deepEqual(
    messages.map((message) => message.channel),
    ['generic', 'feishu', 'wecom']
  );
  assert.equal(messages[0].payload.event, 'designsignal.daily.ready');
  assert.equal(messages[0].payload.report.integritySha256, report.integrity.contentSha256);
  assert.equal(messages[1].payload.msg_type, 'text');
  assert.equal(messages[2].payload.msgtype, 'text');
  const raw = await Promise.all(
    (await fs.readdir(path.join(root, 'outbox'))).map((name) => fs.readFile(path.join(root, 'outbox', name), 'utf8'))
  );
  assert.equal(raw.join('\n').includes('generic-secret'), false);
  assert.equal(raw.join('\n').includes('feishu-secret'), false);
  assert.equal(raw.join('\n').includes('wecom-secret'), false);
  assert.equal((await outboxStatus(root)).pending, 3);
});

test('missing push secret preserves a pending durable message without persisting credentials', async (t) => {
  const root = await temporaryDirectory();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const report = await fixtureReport(root);
  const [message] = await enqueueReportDeliveries(root, report, { DESIGNSIGNAL_PUSH_CHANNELS: 'generic' });
  assert.equal(message.status, 'pending');
  assert.equal(message.lastError.code, 'push_secret_missing');
  const [processed] = await processOutbox(root, {
    environment: {},
    now: () => new Date('2026-07-28T16:00:00Z')
  });
  assert.equal(processed.status, 'pending');
  assert.equal((await outboxStatus(root)).pending, 1);
  const raw = await fs.readFile(path.join(root, 'outbox', (await fs.readdir(path.join(root, 'outbox')))[0]), 'utf8');
  assert.equal(raw.includes('WEBHOOK_URL'), true);
  assert.equal(raw.includes('https://'), false);
});

test('configured webhook sends and marks message sent while endpoint remains memory-only', async (t) => {
  const root = await temporaryDirectory();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const report = await fixtureReport(root);
  const endpoint = 'https://hooks.example.com/send?token=supersecret123';
  const environment = { DESIGNSIGNAL_PUSH_CHANNELS: 'generic', DESIGNSIGNAL_WEBHOOK_URL: endpoint };
  await enqueueReportDeliveries(root, report, environment);
  let requested;
  const [message] = await processOutbox(root, {
    environment,
    transport: async (url, options) => {
      requested = { url, options };
      return { status: 204, headers: {}, bytes: Buffer.alloc(0) };
    },
    now: () => new Date('2026-07-28T16:00:00Z')
  });
  assert.equal(requested.url, endpoint);
  assert.equal(message.status, 'sent');
  const file = path.join(root, 'outbox', (await fs.readdir(path.join(root, 'outbox')))[0]);
  assert.equal((await fs.readFile(file, 'utf8')).includes('supersecret123'), false);
});

test('ambiguous push result stops automatic replay and requires reconciliation', async (t) => {
  const root = await temporaryDirectory();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const report = await fixtureReport(root);
  const endpoint = 'https://hooks.example.com/supersecret123';
  const environment = { DESIGNSIGNAL_PUSH_CHANNELS: 'generic', DESIGNSIGNAL_WEBHOOK_URL: endpoint };
  await enqueueReportDeliveries(root, report, environment);
  const [message] = await processOutbox(root, {
    environment,
    transport: async () => {
      throw new Error(`delivery failed for ${endpoint}`);
    },
    now: () => new Date('2026-07-28T16:00:00Z')
  });
  assert.equal(message.status, 'reconcile_required');
  assert.equal(message.attempts, 1);
  assert.equal(message.lastError.code.includes('supersecret123'), false);
  assert.equal((await outboxStatus(root)).reconcileRequired, 1);
});

test('CLI outbox retry processes due pending messages for operators', async (t) => {
  const root = await temporaryDirectory();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const report = await fixtureReport(root);
  await enqueueReportDeliveries(root, report, { DESIGNSIGNAL_PUSH_CHANNELS: 'generic' });
  const executable = path.resolve('bin', 'designsignal.mjs');
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [executable, 'outbox', '--retry', '--data-dir', root],
    { cwd: path.resolve('.'), timeout: 10_000 }
  );
  assert.equal(stderr, '');
  const value = JSON.parse(stdout);
  assert.equal(value.schemaVersion, 'designsignal.outbox-status.v2');
  assert.equal(value.retry, true);
  assert.equal(value.processedCount, 1);
  assert.equal(value.pending, 1);
  assert.equal(value.messages[0].lastError.code, 'push_secret_missing');
});

test('scheduler computes 23:50 Asia/Shanghai before and after the boundary', () => {
  assert.equal(nextShanghaiRun(new Date('2026-07-28T15:49:00Z')).toISOString(), '2026-07-28T15:50:00.000Z');
  assert.equal(nextShanghaiRun(new Date('2026-07-28T15:50:00Z')).toISOString(), '2026-07-29T15:50:00.000Z');
  assert.equal(scheduleDelay(new Date('2026-07-28T15:49:00Z')), 60_000);
});
