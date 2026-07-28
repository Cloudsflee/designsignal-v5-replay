import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { enqueueReportDeliveries, outboxStatus, processOutbox } from '../src/outbox.mjs';
import { nextShanghaiRun, scheduleDelay } from '../src/scheduler.mjs';
import { fixtureReport, temporaryDirectory } from './helpers.mjs';

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

test('failed push is retried with bounded backoff and redacted error', async (t) => {
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
  assert.equal(message.status, 'pending');
  assert.equal(message.attempts, 1);
  assert.equal(message.lastError.message.includes('supersecret123'), false);
  assert.ok(new Date(message.nextAttemptAt) > new Date('2026-07-28T16:00:00Z'));
});

test('scheduler computes 23:50 Asia/Shanghai before and after the boundary', () => {
  assert.equal(nextShanghaiRun(new Date('2026-07-28T15:49:00Z')).toISOString(), '2026-07-28T15:50:00.000Z');
  assert.equal(nextShanghaiRun(new Date('2026-07-28T15:50:00Z')).toISOString(), '2026-07-29T15:50:00.000Z');
  assert.equal(scheduleDelay(new Date('2026-07-28T15:49:00Z')), 60_000);
});
