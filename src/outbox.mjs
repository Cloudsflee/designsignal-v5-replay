import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWrite } from './storage.mjs';
import { requestBytes } from './security.mjs';
import { deterministicId, publicError, stableStringify } from './util.mjs';

const CHANNELS = {
  generic: { secretEnv: 'DESIGNSIGNAL_WEBHOOK_URL' },
  feishu: { secretEnv: 'FEISHU_WEBHOOK_URL' },
  wecom: { secretEnv: 'WECOM_WEBHOOK_URL' }
};

export async function enqueueReportDeliveries(dataDir, report, environment = process.env) {
  const requested = String(environment.DESIGNSIGNAL_PUSH_CHANNELS || 'generic')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => CHANNELS[item]);
  const messages = [];
  for (const channel of [...new Set(requested)]) {
    const id = deterministicId('msg', report.id, channel);
    const message = {
      schemaVersion: 'designsignal.outbox.v1',
      id,
      reportId: report.id,
      reportDate: report.date,
      channel,
      secretEnv: CHANNELS[channel].secretEnv,
      payload: channelPayload(channel, report),
      status: 'pending',
      attempts: 0,
      lastError: environment[CHANNELS[channel].secretEnv] ? null : { code: 'push_secret_missing' },
      nextAttemptAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      sentAt: null
    };
    await atomicWrite(messagePath(dataDir, message), `${stableStringify(message, 2)}\n`);
    messages.push(message);
  }
  return messages;
}

export async function processOutbox(
  dataDir,
  { environment = process.env, transport = requestBytes, now = () => new Date(), maxAttempts = 8 } = {}
) {
  const directory = path.join(dataDir, 'outbox');
  const names = await fs.readdir(directory).catch((error) => (error.code === 'ENOENT' ? [] : Promise.reject(error)));
  const processed = [];
  for (const name of names.filter((item) => item.endsWith('.json')).sort()) {
    const file = path.join(directory, name);
    const message = JSON.parse(await fs.readFile(file, 'utf8'));
    if (message.status === 'sent' || message.status === 'failed') continue;
    if (new Date(message.nextAttemptAt).getTime() > now().getTime()) continue;
    const endpoint = environment[message.secretEnv];
    if (!endpoint) {
      Object.assign(message, {
        status: 'pending',
        lastError: { code: 'push_secret_missing' },
        nextAttemptAt: new Date(now().getTime() + 60 * 60 * 1000).toISOString()
      });
      await atomicWrite(file, `${stableStringify(message, 2)}\n`);
      processed.push(message);
      continue;
    }
    try {
      const host = new URL(endpoint).hostname;
      const response = await transport(endpoint, {
        allowedHosts: [host],
        timeoutMs: 10_000,
        maxBytes: 500_000,
        retries: 1,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(message.payload)
      });
      if (response.status < 200 || response.status >= 300) throw pushError('push_http_error', response.status);
      Object.assign(message, { status: 'sent', attempts: message.attempts + 1, lastError: null, sentAt: now().toISOString() });
    } catch (error) {
      const attempts = message.attempts + 1;
      Object.assign(message, {
        status: attempts >= maxAttempts ? 'failed' : 'pending',
        attempts,
        lastError: publicError(error, [endpoint]),
        nextAttemptAt: new Date(now().getTime() + Math.min(6 * 60 * 60 * 1000, 30_000 * 2 ** attempts)).toISOString()
      });
    }
    await atomicWrite(file, `${stableStringify(message, 2)}\n`);
    processed.push(message);
  }
  return processed;
}

export async function outboxStatus(dataDir) {
  const directory = path.join(dataDir, 'outbox');
  const names = await fs.readdir(directory).catch((error) => (error.code === 'ENOENT' ? [] : Promise.reject(error)));
  const messages = [];
  for (const name of names.filter((item) => item.endsWith('.json'))) messages.push(JSON.parse(await fs.readFile(path.join(directory, name), 'utf8')));
  return {
    total: messages.length,
    pending: messages.filter((item) => item.status === 'pending').length,
    sent: messages.filter((item) => item.status === 'sent').length,
    failed: messages.filter((item) => item.status === 'failed').length,
    messages
  };
}

function channelPayload(channel, report) {
  const text = `${report.date} 设计信号：${report.items.length}/6 条；命题研判 ${report.hypotheses.length} 条；核心练习 ${report.coreExercise.timeboxMinutes} 分钟。`;
  if (channel === 'feishu') return { msg_type: 'text', content: { text } };
  if (channel === 'wecom') return { msgtype: 'text', text: { content: text } };
  return {
    event: 'designsignal.daily.ready',
    report: {
      id: report.id,
      date: report.date,
      itemCount: report.items.length,
      complete: report.selection.complete,
      integritySha256: report.integrity.contentSha256
    },
    text
  };
}

function messagePath(dataDir, message) {
  return path.join(dataDir, 'outbox', `${message.reportDate}-${message.channel}-${message.id}.json`);
}

function pushError(code, status) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}
