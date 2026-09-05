import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requestBytes } from './security.mjs';
import { atomicWrite, readReport } from './storage.mjs';
import { cleanText, deterministicId, publicError, sha256, stableStringify } from './util.mjs';

const OUTBOX_V2 = 'designsignal.outbox.v2';
const DOCUMENT_API_ORIGIN = 'https://open.feishu.cn';
const MAX_DOCUMENT_CHUNK = 50;
const ACTIVE_STATES = new Set(['pending', 'dispatching', 'retry_wait']);
const TERMINAL_STATES = new Set(['sent', 'reconcile_required', 'failed']);
const DEFINITE_NETWORK_CODES = new Set([
  'url_invalid',
  'https_required',
  'url_credentials_forbidden',
  'url_port_forbidden',
  'host_not_allowed',
  'private_network_forbidden',
  'response_too_large',
  'redirect_for_method_forbidden'
]);

export const CHANNEL_REGISTRY = Object.freeze({
  generic: Object.freeze({ mode: 'webhook', secretEnv: 'DESIGNSIGNAL_WEBHOOK_URL' }),
  feishu: Object.freeze({ mode: 'webhook', secretEnv: 'FEISHU_WEBHOOK_URL' }),
  wecom: Object.freeze({ mode: 'webhook', secretEnv: 'WECOM_WEBHOOK_URL' }),
  'feishu-document': Object.freeze({
    mode: 'document',
    appIdEnv: 'FEISHU_APP_ID',
    appSecretEnv: 'FEISHU_APP_SECRET',
    folderTokenEnv: 'FEISHU_DOC_FOLDER_TOKEN'
  })
});

export async function enqueueReportDeliveries(dataDir, report, environment = process.env) {
  const requested = String(environment.DESIGNSIGNAL_PUSH_CHANNELS || 'feishu')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => CHANNEL_REGISTRY[item]);
  const messages = [];
  for (const channel of [...new Set(requested)]) {
    const registry = CHANNEL_REGISTRY[channel];
    const id = deterministicId('msg', report.id, channel, OUTBOX_V2);
    const createdAt = new Date(report.generatedAt || Date.now()).toISOString();
    const payload = channelPayload(channel, report);
    const message = {
      schemaVersion: OUTBOX_V2,
      id,
      reportId: report.id,
      reportDate: report.date,
      reportFingerprint: report.integrity.contentSha256,
      channel,
      secretEnv: registry.mode === 'webhook' ? registry.secretEnv : null,
      configurationRefs:
        registry.mode === 'webhook'
          ? [registry.secretEnv]
          : [registry.appIdEnv, registry.appSecretEnv, registry.folderTokenEnv],
      taskHash: null,
      payload,
      status: 'pending',
      attempts: 0,
      retryCount: 0,
      lastError: configurationPresent(channel, environment) ? null : { code: missingConfigurationCode(channel) },
      nextAttemptAt: createdAt,
      createdAt,
      updatedAt: createdAt,
      dispatch: null,
      document:
        registry.mode === 'document'
          ? {
              documentId: null,
              revision: 0,
              cursor: 0,
              confirmedBlocks: 0,
              totalBlocks: payload.document.blocks.length,
              chunkSize: MAX_DOCUMENT_CHUNK,
              renderFingerprint: sha256(stableStringify(payload.document.blocks))
            }
          : null,
      sentAt: null,
      publicDocumentUrl: null
    };
    message.taskHash = computeTaskHash(message);
    const file = messagePath(dataDir, message);
    try {
      await atomicWrite(file, `${stableStringify(message, 2)}\n`, { overwrite: false });
      messages.push(message);
    } catch (error) {
      if (error.code !== 'atomic_destination_exists') throw error;
      const existing = JSON.parse(await fs.readFile(file, 'utf8'));
      assertV2Identity(existing);
      if (existing.taskHash !== message.taskHash || existing.reportFingerprint !== message.reportFingerprint)
        throw outboxError('outbox_identity_conflict');
      messages.push(existing);
    }
  }
  return messages;
}

export async function processOutbox(
  dataDir,
  {
    environment = process.env,
    transport = requestBytes,
    now = () => new Date(),
    maxAttempts = 8,
    signal = null
  } = {}
) {
  const records = await readOutboxRecords(dataDir);
  const processed = [];
  for (const record of records) {
    const result = await withMessageLock(
      record.file,
      async () => {
        const current = JSON.parse(await fs.readFile(record.file, 'utf8'));
        if (current.schemaVersion === OUTBOX_V2)
          return processV2Message(current, record.file, dataDir, { environment, transport, now, maxAttempts, signal });
        if (current.channel === 'feishu-document' && current.schemaVersion === 1)
          return processLegacyDocument(current, record.file, dataDir, { environment, transport, now, maxAttempts, signal });
        if (current.schemaVersion === 'designsignal.outbox.v1')
          return processLegacyWebhook(current, record.file, { environment, transport, now, maxAttempts, signal });
        throw outboxError('outbox_schema_unknown');
      },
      now
    );
    if (result) processed.push(publicMessage(result, environment));
  }
  return processed;
}

export async function reconcileOutbox(
  dataDir,
  { id, observed, documentId = null, revision = null, confirmedBlocks = null, confirm = false } = {},
  { environment = process.env, now = () => new Date() } = {}
) {
  if (!confirm) throw outboxError('outbox_reconcile_confirmation_required');
  const records = await readOutboxRecords(dataDir);
  const matches = [];
  for (const record of records) {
    const message = JSON.parse(await fs.readFile(record.file, 'utf8'));
    if (message.id === id) matches.push({ ...record, message });
  }
  if (matches.length !== 1) throw outboxError(matches.length ? 'outbox_reconcile_identity_ambiguous' : 'outbox_message_not_found');
  const record = matches[0];
  const reconciled = await withMessageLock(
    record.file,
    async () => {
      const message = JSON.parse(await fs.readFile(record.file, 'utf8'));
      if (message.schemaVersion === OUTBOX_V2)
        return reconcileV2Message(message, record.file, dataDir, { observed, documentId, revision, confirmedBlocks, now, environment });
      if (message.channel === 'feishu-document' && message.schemaVersion === 1)
        return reconcileLegacyDocument(message, record.file, dataDir, { observed, documentId, revision, confirmedBlocks, now, environment });
      throw outboxError('outbox_reconcile_schema_unsupported');
    },
    now
  );
  return publicMessage(reconciled, environment);
}

export async function outboxStatus(dataDir, { environment = process.env, includeReportIdentity = false } = {}) {
  const records = await readOutboxRecords(dataDir);
  const messages = [];
  for (const record of records) {
    const value = JSON.parse(await fs.readFile(record.file, 'utf8'));
    messages.push(publicMessage(value, environment, includeReportIdentity));
  }
  const count = (status) => messages.filter((item) => item.status === status).length;
  return {
    schemaVersion: 'designsignal.outbox-status.v2',
    total: messages.length,
    pending: count('pending'),
    dispatching: count('dispatching'),
    sent: count('sent'),
    retryWait: count('retry_wait'),
    reconcileRequired: count('reconcile_required'),
    failed: count('failed'),
    messages: messages.sort((left, right) => left.id.localeCompare(right.id))
  };
}

async function processV2Message(message, file, dataDir, context) {
  assertV2Identity(message);
  const report = await readReport(dataDir, message.reportDate);
  if (report && (report.id !== message.reportId || report.integrity?.contentSha256 !== message.reportFingerprint)) {
    message.status = 'failed';
    message.lastError = { code: 'outbox_report_identity_invalid' };
    message.updatedAt = context.now().toISOString();
    await storeMessage(file, message);
    return message;
  }
  if (message.status === 'dispatching') {
    markReconcile(message, 'dispatch_interrupted', context.now);
    await storeMessage(file, message);
    return message;
  }
  if (TERMINAL_STATES.has(message.status)) return message;
  if (!ACTIVE_STATES.has(message.status)) throw outboxError('outbox_status_invalid');
  if (new Date(message.nextAttemptAt).getTime() > context.now().getTime()) return message;
  if (context.signal?.aborted) throw context.signal.reason || outboxError('request_aborted');
  return CHANNEL_REGISTRY[message.channel].mode === 'document'
    ? processV2Document(message, file, context)
    : processV2Webhook(message, file, context);
}

async function processV2Webhook(message, file, context) {
  const registry = CHANNEL_REGISTRY[message.channel];
  const endpoint = context.environment[registry.secretEnv];
  if (!endpoint) {
    markMissingConfiguration(message, missingConfigurationCode(message.channel), context.now);
    await storeMessage(file, message);
    return message;
  }
  beginDispatch(message, { phase: 'webhook', cursor: null, chunkSize: null }, context.now);
  await storeMessage(file, message);
  try {
    let host;
    try {
      host = new URL(endpoint).hostname;
    } catch {
      throw deliveryError('url_invalid', 'definite');
    }
    const response = await context.transport(endpoint, {
      allowedHosts: [host],
      timeoutMs: 10_000,
      maxBytes: 500_000,
      retries: 0,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': message.taskHash,
        'x-designsignal-task-hash': message.taskHash
      },
      body: JSON.stringify(message.payload),
      signal: context.signal
    });
    assertWebhookAccepted(message.channel, response);
    markSent(message, context.now);
  } catch (error) {
    applyDeliveryFailure(message, classifyDeliveryFailure(error, { remoteSideEffect: true }), context);
  }
  await storeMessage(file, message);
  return message;
}

async function processV2Document(message, file, context) {
  assertDocumentProgress(message);
  if (!configurationPresent('feishu-document', context.environment)) {
    markMissingConfiguration(message, missingConfigurationCode('feishu-document'), context.now);
    await storeMessage(file, message);
    return message;
  }
  let token;
  try {
    token = await requestTenantToken(context);
  } catch (error) {
    applyDeliveryFailure(message, classifyDeliveryFailure(error, { remoteSideEffect: false }), context);
    await storeMessage(file, message);
    return message;
  }

  if (!message.document.documentId) {
    beginDispatch(message, { phase: 'document_create', cursor: 0, chunkSize: 0 }, context.now);
    await storeMessage(file, message);
    try {
      const data = await requestDocumentJson(
        `${DOCUMENT_API_ORIGIN}/open-apis/docx/v1/documents`,
        {
          headers: documentHeaders(token),
          body: JSON.stringify({
            folder_token: context.environment.FEISHU_DOC_FOLDER_TOKEN,
            title: message.payload.document.title
          })
        },
        context,
        true
      );
      const identity = validateDocumentIdentity(data?.data?.document);
      message.document.documentId = identity.documentId;
      message.document.revision = identity.revision;
      message.status = 'pending';
      message.lastError = null;
      message.updatedAt = context.now().toISOString();
      message.dispatch = null;
      await storeMessage(file, message);
    } catch (error) {
      applyDeliveryFailure(message, classifyDeliveryFailure(error, { remoteSideEffect: true }), context);
      await storeMessage(file, message);
      return message;
    }
  }

  const blocks = message.payload.document.blocks;
  if (sha256(stableStringify(blocks)) !== message.document.renderFingerprint || blocks.length !== message.document.totalBlocks) {
    markReconcile(message, 'document_render_fingerprint_mismatch', context.now);
    await storeMessage(file, message);
    return message;
  }
  while (message.document.cursor < blocks.length) {
    const cursor = message.document.cursor;
    const children = blocks.slice(cursor, cursor + MAX_DOCUMENT_CHUNK);
    const revision = message.document.revision;
    const clientToken = documentChunkToken(message, cursor, children.length, revision);
    beginDispatch(
      message,
      { phase: 'document_write', cursor, chunkSize: children.length, revision, clientToken },
      context.now
    );
    await storeMessage(file, message);
    try {
      const id = encodeURIComponent(message.document.documentId);
      const query = new URLSearchParams({ document_revision_id: String(revision), client_token: clientToken });
      const data = await requestDocumentJson(
        `${DOCUMENT_API_ORIGIN}/open-apis/docx/v1/documents/${id}/blocks/${id}/children?${query}`,
        {
          headers: documentHeaders(token),
          body: JSON.stringify({ children, index: cursor })
        },
        context,
        true
      );
      const nextRevision = data?.data?.document_revision_id ?? data?.data?.revision_id;
      if (!validRevision(nextRevision)) throw deliveryError('document_write_response_ambiguous', 'ambiguous');
      message.document.revision = Number(nextRevision);
      message.document.cursor = cursor + children.length;
      message.document.confirmedBlocks = message.document.cursor;
      message.dispatch = null;
      message.lastError = null;
      message.updatedAt = context.now().toISOString();
      if (message.document.cursor === blocks.length) {
        message.publicDocumentUrl = safeDocumentUrl(context.environment, message.document.documentId);
        markSent(message, context.now);
      } else message.status = 'pending';
      await storeMessage(file, message);
    } catch (error) {
      applyDeliveryFailure(message, classifyDeliveryFailure(error, { remoteSideEffect: true }), context);
      await storeMessage(file, message);
      return message;
    }
  }
  return message;
}

async function requestTenantToken(context) {
  const data = await requestDocumentJson(
    `${DOCUMENT_API_ORIGIN}/open-apis/auth/v3/tenant_access_token/internal`,
    {
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        app_id: context.environment.FEISHU_APP_ID,
        app_secret: context.environment.FEISHU_APP_SECRET
      })
    },
    context,
    false
  );
  if (!cleanText(data?.tenant_access_token, 4096)) throw deliveryError('tenant_token_invalid', 'retryable');
  return data.tenant_access_token;
}

async function requestDocumentJson(url, request, context, remoteSideEffect) {
  let response;
  try {
    response = await context.transport(url, {
      allowedHosts: ['open.feishu.cn'],
      timeoutMs: 10_000,
      maxBytes: 500_000,
      retries: 0,
      method: 'POST',
      headers: request.headers,
      body: request.body,
      signal: context.signal
    });
  } catch (error) {
    throw classifyDeliveryFailure(error, { remoteSideEffect });
  }
  if ([408, 425, 429].includes(response.status)) throw deliveryError('delivery_explicitly_unaccepted', 'retryable');
  if (response.status >= 500) throw deliveryError('delivery_remote_result_ambiguous', remoteSideEffect ? 'ambiguous' : 'retryable');
  if (response.status < 200 || response.status >= 300) throw deliveryError('delivery_definite_rejection', 'definite');
  let data;
  try {
    data = JSON.parse(response.bytes.toString('utf8'));
  } catch {
    throw deliveryError('delivery_success_response_malformed', remoteSideEffect ? 'ambiguous' : 'retryable');
  }
  if (data?.code !== 0) throw deliveryError('delivery_definite_rejection', 'definite');
  return data;
}

async function processLegacyWebhook(message, file, context) {
  if (['sent', 'failed'].includes(message.status)) return message;
  if (new Date(message.nextAttemptAt).getTime() > context.now().getTime()) return message;
  const endpoint = context.environment[message.secretEnv];
  if (!endpoint) {
    message.status = 'pending';
    message.lastError = { code: 'push_secret_missing' };
    message.nextAttemptAt = new Date(context.now().getTime() + 60 * 60 * 1000).toISOString();
    await storeMessage(file, message);
    return message;
  }
  try {
    const host = new URL(endpoint).hostname;
    const response = await context.transport(endpoint, {
      allowedHosts: [host],
      timeoutMs: 10_000,
      maxBytes: 500_000,
      retries: 0,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(message.payload),
      signal: context.signal
    });
    if (response.status < 200 || response.status >= 300) throw deliveryError('legacy_push_rejected', 'definite');
    message.status = 'sent';
    message.attempts = Number(message.attempts || 0) + 1;
    message.lastError = null;
    message.sentAt = context.now().toISOString();
  } catch (error) {
    const failure = classifyDeliveryFailure(error, { remoteSideEffect: true });
    message.attempts = Number(message.attempts || 0) + 1;
    message.status = failure.kind === 'ambiguous' || message.attempts >= context.maxAttempts ? 'failed' : 'pending';
    message.lastError = { code: failure.kind === 'ambiguous' ? 'legacy_delivery_ambiguous' : failure.code };
    message.nextAttemptAt = new Date(context.now().getTime() + retryDelay(message.attempts)).toISOString();
  }
  await storeMessage(file, message);
  return message;
}

async function processLegacyDocument(job, file, dataDir, context) {
  if (['creating', 'writing'].includes(job.state)) {
    const interrupted = job.state;
    job.state = 'reconciliation-required';
    job.reason = `interrupted-${interrupted === 'creating' ? 'create' : 'write'}`;
    job.reconciliationRequiredAt = context.now().toISOString();
    await storeMessage(file, job);
    return job;
  }
  if (['delivered', 'reconciliation-required'].includes(job.state)) return job;
  if (new Date(job.nextAttemptAt).getTime() > context.now().getTime()) return job;
  if (!configurationPresent('feishu-document', context.environment)) return job;
  const report = await readReport(dataDir, job.reportDate);
  const blocks = report ? renderFeishuDocumentBlocks(report) : [];
  if (!report || sha256(stableStringify(blocks)) !== job.renderFingerprint || blocks.length !== job.totalBlocks) {
    job.state = 'reconciliation-required';
    job.reason = 'render-fingerprint-mismatch';
    job.reconciliationRequiredAt = context.now().toISOString();
    await storeMessage(file, job);
    return job;
  }
  try {
    const token = await requestTenantToken(context);
    if (!job.documentId) {
      job.state = 'creating';
      job.creatingAt = context.now().toISOString();
      await storeMessage(file, job);
      const data = await requestDocumentJson(
        `${DOCUMENT_API_ORIGIN}/open-apis/docx/v1/documents`,
        {
          headers: documentHeaders(token),
          body: JSON.stringify({ folder_token: context.environment.FEISHU_DOC_FOLDER_TOKEN, title: `DesignSignal 337/902 - ${job.reportDate}` })
        },
        context,
        true
      );
      const identity = validateDocumentIdentity(data?.data?.document);
      job.documentId = identity.documentId;
      job.revisionId = identity.revision;
      job.state = 'created';
      job.createdDocumentAt = context.now().toISOString();
      await storeMessage(file, job);
    }
    while (job.nextBlockIndex < blocks.length) {
      const cursor = job.nextBlockIndex;
      const children = blocks.slice(cursor, cursor + MAX_DOCUMENT_CHUNK);
      const revision = job.revisionId;
      const clientToken = sha256(`${job.id}:${job.documentId}:${cursor}:${children.length}:${revision}:${job.renderFingerprint}`).slice(0, 32);
      Object.assign(job, {
        state: 'writing',
        chunkCursor: cursor,
        chunkSize: children.length,
        chunkRevisionId: revision,
        clientToken,
        writingAt: context.now().toISOString()
      });
      await storeMessage(file, job);
      const id = encodeURIComponent(job.documentId);
      const query = new URLSearchParams({ document_revision_id: String(revision), client_token: clientToken });
      const data = await requestDocumentJson(
        `${DOCUMENT_API_ORIGIN}/open-apis/docx/v1/documents/${id}/blocks/${id}/children?${query}`,
        { headers: documentHeaders(token), body: JSON.stringify({ children, index: cursor }) },
        context,
        true
      );
      const nextRevision = data?.data?.document_revision_id ?? data?.data?.revision_id;
      if (!validRevision(nextRevision)) throw deliveryError('document_write_response_ambiguous', 'ambiguous');
      job.revisionId = Number(nextRevision);
      job.nextBlockIndex = cursor + children.length;
      clearLegacyChunk(job);
      job.state = job.nextBlockIndex === blocks.length ? 'delivered' : 'created';
      if (job.state === 'delivered') job.deliveredAt = context.now().toISOString();
      else job.confirmedChunkAt = context.now().toISOString();
      await storeMessage(file, job);
    }
  } catch (error) {
    const failure = classifyDeliveryFailure(error, { remoteSideEffect: ['creating', 'writing'].includes(job.state) });
    if (failure.kind === 'ambiguous') {
      job.state = 'reconciliation-required';
      job.reason = failure.code;
      job.reconciliationRequiredAt = context.now().toISOString();
    } else {
      job.attempts = Number(job.attempts || 0) + 1;
      clearLegacyChunk(job);
      job.state = job.documentId ? 'created' : 'pending';
      job.reason = failure.code;
      job.nextAttemptAt = new Date(context.now().getTime() + retryDelay(job.attempts)).toISOString();
    }
    await storeMessage(file, job);
  }
  return job;
}

async function reconcileV2Message(message, file, dataDir, input) {
  assertV2Identity(message);
  if (message.status !== 'reconcile_required') throw outboxError('outbox_reconcile_state_invalid');
  const report = await readReport(dataDir, message.reportDate);
  if (!report || report.id !== message.reportId || report.integrity?.contentSha256 !== message.reportFingerprint)
    throw outboxError('outbox_reconcile_report_fingerprint_invalid');
  if (input.observed === 'absent') {
    if (message.channel === 'feishu-document' && message.document.cursor !== 0)
      throw outboxError('outbox_reconcile_cursor_conflict');
    message.status = 'pending';
    message.lastError = { code: 'reconciled_absent_confirmed' };
    message.nextAttemptAt = input.now().toISOString();
    message.dispatch = null;
  } else if (input.observed === 'document') {
    if (message.channel !== 'feishu-document') throw outboxError('outbox_reconcile_observation_invalid');
    const revision = Number(input.revision);
    const confirmed = Number(input.confirmedBlocks);
    if (!validDocumentId(input.documentId) || !validRevision(revision) || !Number.isInteger(confirmed))
      throw outboxError('outbox_reconcile_document_invalid');
    if (confirmed < message.document.cursor || confirmed > message.document.totalBlocks)
      throw outboxError('outbox_reconcile_cursor_conflict');
    if (message.document.documentId && message.document.documentId !== input.documentId)
      throw outboxError('outbox_reconcile_document_identity_conflict');
    if (message.dispatch?.phase === 'document_write') {
      const allowed = new Set([message.dispatch.cursor, message.dispatch.cursor + message.dispatch.chunkSize]);
      if (!allowed.has(confirmed)) throw outboxError('outbox_reconcile_confirmed_blocks_invalid');
    }
    message.document.documentId = input.documentId;
    message.document.revision = revision;
    message.document.cursor = confirmed;
    message.document.confirmedBlocks = confirmed;
    message.dispatch = null;
    message.lastError = { code: 'reconciled_document_confirmed' };
    if (confirmed === message.document.totalBlocks) {
      message.publicDocumentUrl = safeDocumentUrl(input.environment, input.documentId);
      markSent(message, input.now);
    } else {
      message.status = 'pending';
      message.nextAttemptAt = input.now().toISOString();
    }
  } else throw outboxError('outbox_reconcile_observation_invalid');
  message.updatedAt = input.now().toISOString();
  await storeMessage(file, message);
  return message;
}

async function reconcileLegacyDocument(job, file, dataDir, input) {
  if (job.state !== 'reconciliation-required') throw outboxError('outbox_reconcile_state_invalid');
  const report = await readReport(dataDir, job.reportDate);
  const blocks = report ? renderFeishuDocumentBlocks(report) : [];
  if (!report || sha256(stableStringify(blocks)) !== job.renderFingerprint || blocks.length !== job.totalBlocks)
    throw outboxError('outbox_reconcile_report_fingerprint_invalid');
  if (input.observed === 'absent') {
    if (job.nextBlockIndex !== 0) throw outboxError('outbox_reconcile_cursor_conflict');
    job.state = 'pending';
    job.reason = 'reconciled-absent-confirmed';
    job.nextAttemptAt = input.now().toISOString();
    clearLegacyChunk(job);
  } else if (input.observed === 'document') {
    const revision = Number(input.revision);
    const confirmed = Number(input.confirmedBlocks);
    if (!validDocumentId(input.documentId) || !validRevision(revision) || !Number.isInteger(confirmed) || confirmed < job.nextBlockIndex || confirmed > job.totalBlocks)
      throw outboxError('outbox_reconcile_document_invalid');
    job.documentId = input.documentId;
    job.revisionId = revision;
    job.nextBlockIndex = confirmed;
    clearLegacyChunk(job);
    job.state = confirmed === job.totalBlocks ? 'delivered' : 'created';
    job.reason = 'reconciled-document-confirmed';
    if (job.state === 'delivered') job.deliveredAt = input.now().toISOString();
  } else throw outboxError('outbox_reconcile_observation_invalid');
  await storeMessage(file, job);
  return job;
}

function assertV2Identity(message) {
  if (
    message?.schemaVersion !== OUTBOX_V2 ||
    !/^msg_[a-f0-9]{20}$/.test(message.id || '') ||
    !CHANNEL_REGISTRY[message.channel] ||
    !/^\d{4}-\d{2}-\d{2}$/.test(message.reportDate || '') ||
    !/^[a-f0-9]{64}$/.test(message.reportFingerprint || '') ||
    !/^[a-f0-9]{64}$/.test(message.taskHash || '') ||
    message.taskHash !== computeTaskHash(message) ||
    ![...ACTIVE_STATES, ...TERMINAL_STATES].includes(message.status) ||
    !Number.isSafeInteger(message.attempts) ||
    message.attempts < 0 ||
    !Number.isSafeInteger(message.retryCount) ||
    message.retryCount < 0 ||
    !Number.isFinite(Date.parse(message.createdAt)) ||
    !Number.isFinite(Date.parse(message.nextAttemptAt))
  )
    throw outboxError('outbox_identity_invalid');
  if (message.channel === 'feishu-document') assertDocumentProgress(message);
  return message;
}

function assertDocumentProgress(message) {
  const document = message.document;
  if (
    !document ||
    !Number.isInteger(document.cursor) ||
    !Number.isInteger(document.confirmedBlocks) ||
    document.confirmedBlocks !== document.cursor ||
    !Number.isInteger(document.totalBlocks) ||
    document.totalBlocks < 1 ||
    document.cursor < 0 ||
    document.cursor > document.totalBlocks ||
    document.chunkSize !== MAX_DOCUMENT_CHUNK ||
    !/^[a-f0-9]{64}$/.test(document.renderFingerprint || '') ||
    sha256(stableStringify(message.payload?.document?.blocks || [])) !== document.renderFingerprint
  )
    throw outboxError('outbox_document_progress_invalid');
  if (document.documentId && (!validDocumentId(document.documentId) || !validRevision(document.revision)))
    throw outboxError('outbox_document_identity_invalid');
  if (message.dispatch?.phase === 'document_write') {
    const expected = documentChunkToken(
      message,
      message.dispatch.cursor,
      message.dispatch.chunkSize,
      message.dispatch.revision
    );
    if (
      message.dispatch.cursor !== document.cursor ||
      message.dispatch.chunkSize < 1 ||
      message.dispatch.chunkSize > MAX_DOCUMENT_CHUNK ||
      message.dispatch.cursor + message.dispatch.chunkSize > document.totalBlocks ||
      message.dispatch.clientToken !== expected
    )
      throw outboxError('outbox_document_dispatch_invalid');
  }
}

function computeTaskHash(message) {
  return sha256(
    stableStringify({
      schemaVersion: OUTBOX_V2,
      id: message.id,
      reportId: message.reportId,
      reportDate: message.reportDate,
      reportFingerprint: message.reportFingerprint,
      channel: message.channel,
      payload: message.payload
    })
  );
}

function beginDispatch(message, dispatch, now) {
  message.status = 'dispatching';
  message.attempts += 1;
  message.lastError = null;
  message.updatedAt = now().toISOString();
  message.dispatch = { ...dispatch, startedAt: message.updatedAt, taskHash: message.taskHash };
}

function markSent(message, now) {
  message.status = 'sent';
  message.lastError = null;
  message.dispatch = null;
  message.sentAt = now().toISOString();
  message.updatedAt = message.sentAt;
}

function markMissingConfiguration(message, code, now) {
  message.status = 'pending';
  message.lastError = { code };
  message.dispatch = null;
  message.updatedAt = now().toISOString();
  message.nextAttemptAt = new Date(now().getTime() + 60 * 60 * 1000).toISOString();
}

function markReconcile(message, code, now) {
  message.status = 'reconcile_required';
  message.lastError = { code };
  message.updatedAt = now().toISOString();
  message.nextAttemptAt = message.updatedAt;
}

function applyDeliveryFailure(message, failure, context) {
  if (failure.kind === 'ambiguous') {
    markReconcile(message, failure.code, context.now);
    return;
  }
  if (failure.kind === 'definite') {
    message.status = 'failed';
    message.retryCount += 1;
    message.lastError = { code: failure.code };
    message.dispatch = null;
    message.updatedAt = context.now().toISOString();
    return;
  }
  message.retryCount += 1;
  message.status = message.retryCount >= context.maxAttempts ? 'failed' : 'retry_wait';
  message.lastError = { code: failure.code };
  message.dispatch = null;
  message.updatedAt = context.now().toISOString();
  message.nextAttemptAt = new Date(context.now().getTime() + retryDelay(message.retryCount)).toISOString();
}

function classifyDeliveryFailure(error, { remoteSideEffect }) {
  if (error instanceof DeliveryError) return error;
  const safe = publicError(error);
  if (DEFINITE_NETWORK_CODES.has(safe.code)) return deliveryError(safe.code, 'definite');
  return deliveryError(safe.code || 'delivery_request_failed', remoteSideEffect ? 'ambiguous' : 'retryable');
}

class DeliveryError extends Error {
  constructor(code, kind) {
    super(code);
    this.code = code;
    this.kind = kind;
  }
}

function deliveryError(code, kind) {
  return new DeliveryError(code, kind);
}

function assertWebhookAccepted(channel, response) {
  if ([408, 425, 429].includes(response.status)) throw deliveryError('delivery_explicitly_unaccepted', 'retryable');
  if (response.status >= 500) throw deliveryError('delivery_remote_result_ambiguous', 'ambiguous');
  if (response.status < 200 || response.status >= 300) throw deliveryError('delivery_definite_rejection', 'definite');
  if (channel === 'generic') return;
  let payload;
  try {
    payload = JSON.parse(response.bytes.toString('utf8'));
  } catch {
    throw deliveryError('delivery_success_response_malformed', 'ambiguous');
  }
  if (channel === 'feishu') {
    if (payload?.code === 0 || payload?.StatusCode === 0) return;
    if ('code' in (payload || {}) || 'StatusCode' in (payload || {}))
      throw deliveryError('delivery_definite_rejection', 'definite');
  }
  if (channel === 'wecom') {
    if (payload?.errcode === 0) return;
    if ('errcode' in (payload || {})) throw deliveryError('delivery_definite_rejection', 'definite');
  }
  throw deliveryError('delivery_success_response_malformed', 'ambiguous');
}

function validateDocumentIdentity(document) {
  if (!validDocumentId(document?.document_id) || !validRevision(document?.revision_id))
    throw deliveryError('document_create_response_ambiguous', 'ambiguous');
  return { documentId: document.document_id, revision: Number(document.revision_id) };
}

function validDocumentId(value) {
  return /^[A-Za-z0-9_-]{8,128}$/.test(String(value || ''));
}

function validRevision(value) {
  return Number.isSafeInteger(Number(value)) && Number(value) >= 0;
}

function documentChunkToken(message, cursor, size, revision) {
  return sha256(
    `${message.id}:${message.document.documentId}:${cursor}:${size}:${revision}:${message.document.renderFingerprint}:${message.taskHash}`
  ).slice(0, 32);
}

function documentHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json; charset=utf-8',
    'user-agent': 'DesignSignal/6.0'
  };
}

function safeDocumentUrl(environment, documentId) {
  let origin = 'https://feishu.cn';
  try {
    const configured = new URL(environment.FEISHU_TENANT_BASE_URL || origin);
    if (configured.protocol === 'https:' && !configured.username && !configured.password) origin = configured.origin;
  } catch {
    origin = 'https://feishu.cn';
  }
  return `${origin}/docx/${encodeURIComponent(documentId)}`;
}

function configurationPresent(channel, environment) {
  const registry = CHANNEL_REGISTRY[channel];
  if (registry.mode === 'webhook') return Boolean(environment[registry.secretEnv]);
  return Boolean(
    environment[registry.appIdEnv] && environment[registry.appSecretEnv] && environment[registry.folderTokenEnv]
  );
}

function missingConfigurationCode(channel) {
  return channel === 'feishu-document' ? 'feishu_document_config_missing' : 'push_secret_missing';
}

function channelPayload(channel, report) {
  const text = `${report.date} 设计信号：${report.items.length}/6 条；结果 ${report.outcome?.status || 'unknown'}；命题研判 ${report.hypotheses.length} 条；核心练习 ${report.coreExercise.timeboxMinutes} 分钟。`;
  if (channel === 'feishu') return { msg_type: 'text', content: { text } };
  if (channel === 'wecom') return { msgtype: 'text', text: { content: text } };
  if (channel === 'feishu-document')
    return {
      document: {
        title: `DesignSignal 337/902 - ${report.date}`,
        blocks: renderFeishuDocumentBlocks(report)
      }
    };
  return {
    event: 'designsignal.daily.ready',
    report: {
      id: report.id,
      date: report.date,
      itemCount: report.items.length,
      outcome: report.outcome?.status || null,
      integritySha256: report.integrity.contentSha256
    },
    text
  };
}

export function renderFeishuDocumentBlocks(report) {
  const blocks = [headingBlock(`${report.date} 设计信号`, 1), textBlock(`Outcome: ${report.outcome?.status || 'unknown'}`)];
  for (const item of report.items || []) {
    blocks.push(headingBlock(`${item.category.toUpperCase()} · ${item.title.zh}`, 2));
    blocks.push(textBlock(item.evidence.zh));
    blocks.push(textBlock(`Why learn: ${item.whyLearn.zh}`));
    blocks.push(textBlock(`Study action: ${item.studyAction.zh}`));
  }
  blocks.push(headingBlock('命题研判', 2));
  for (const hypothesis of report.hypotheses || []) blocks.push(textBlock(hypothesis.claim.zh));
  blocks.push(headingBlock(report.coreExercise?.title?.zh || '核心练习', 2));
  blocks.push(textBlock(report.coreExercise?.prompt?.zh || ''));
  return blocks;
}

function headingBlock(text, level) {
  const key = level === 1 ? 'heading1' : 'heading2';
  return { block_type: level === 1 ? 3 : 4, [key]: richText(text) };
}

function textBlock(text) {
  return { block_type: 2, text: richText(text) };
}

function richText(text) {
  return { elements: [{ text_run: { content: cleanText(text, 20_000), text_element_style: {} } }], style: {} };
}

function publicMessage(message, environment, includeReportIdentity = false) {
  if (message.schemaVersion === OUTBOX_V2) {
    return compact({
      id: message.id,
      reportDate: includeReportIdentity ? message.reportDate : undefined,
      channel: message.channel,
      status: message.status,
      attempt: message.attempts,
      attempts: message.attempts,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      nextAttemptAt: message.nextAttemptAt,
      sentAt: message.sentAt,
      errorCode: message.lastError?.code || null,
      lastError: message.lastError?.code ? { code: message.lastError.code } : null,
      publicDocumentUrl: message.publicDocumentUrl || null
    });
  }
  if (message.channel === 'feishu-document' && message.schemaVersion === 1) {
    const status = {
      pending: 'pending',
      creating: 'dispatching',
      created: 'pending',
      writing: 'dispatching',
      delivered: 'sent',
      'reconciliation-required': 'reconcile_required'
    }[message.state] || 'failed';
    return compact({
      id: message.id,
      reportDate: includeReportIdentity ? message.reportDate : undefined,
      channel: message.channel,
      status,
      attempt: Number(message.attempts || 0),
      attempts: Number(message.attempts || 0),
      createdAt: message.createdAt,
      updatedAt: message.deliveredAt || message.reconciliationRequiredAt || message.confirmedChunkAt || message.createdAt,
      nextAttemptAt: message.nextAttemptAt,
      sentAt: message.deliveredAt || null,
      errorCode: message.reason || null,
      lastError: message.reason ? { code: message.reason } : null,
      publicDocumentUrl: message.state === 'delivered' && message.documentId ? safeDocumentUrl(environment, message.documentId) : null
    });
  }
  return compact({
    id: message.id,
    reportDate: includeReportIdentity ? message.reportDate : undefined,
    channel: message.channel,
    status: message.status,
    attempt: Number(message.attempts || 0),
    attempts: Number(message.attempts || 0),
    createdAt: message.createdAt,
    updatedAt: message.sentAt || message.nextAttemptAt || message.createdAt,
    nextAttemptAt: message.nextAttemptAt,
    sentAt: message.sentAt || null,
    errorCode: message.lastError?.code || null,
    lastError: message.lastError?.code ? { code: message.lastError.code } : null,
    publicDocumentUrl: null
  });
}

async function readOutboxRecords(dataDir) {
  const directory = path.join(dataDir, 'outbox');
  const names = await fs.readdir(directory).catch((error) => (error.code === 'ENOENT' ? [] : Promise.reject(error)));
  return names
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => ({ name, file: path.join(directory, name) }));
}

async function withMessageLock(file, operation, now, staleAfterMs = 30 * 60 * 1000) {
  const lock = `${file}.lock`;
  let handle;
  try {
    try {
      handle = await fs.open(lock, 'wx', 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const stat = await fs.stat(lock).catch(() => null);
      if (!stat || now().getTime() - stat.mtimeMs <= staleAfterMs) return null;
      await fs.rename(lock, `${lock}.stale-${randomUUID()}`).catch(() => undefined);
      handle = await fs.open(lock, 'wx', 0o600);
    }
    await handle.writeFile(`${stableStringify({ createdAt: now().toISOString(), pid: process.pid })}\n`);
    await handle.sync();
    return await operation();
  } finally {
    await handle?.close().catch(() => undefined);
    if (handle) await fs.unlink(lock).catch(() => undefined);
  }
}

async function storeMessage(file, message) {
  await atomicWrite(file, `${stableStringify(message, 2)}\n`);
}

function messagePath(dataDir, message) {
  return path.join(dataDir, 'outbox', `${message.reportDate}-${message.channel}-${message.id}.json`);
}

function clearLegacyChunk(job) {
  for (const key of ['chunkCursor', 'chunkSize', 'chunkRevisionId', 'clientToken', 'writingAt']) delete job[key];
}

function retryDelay(attempt) {
  return Math.min(6 * 60 * 60 * 1000, 30_000 * 2 ** Math.min(10, Math.max(1, Number(attempt) || 1)));
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function outboxError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
