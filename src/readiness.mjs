import fs from 'node:fs/promises';
import path from 'node:path';
import { deriveReportOutcome } from './outcome.mjs';
import { outboxStatus } from './outbox.mjs';
import { readRunReceiptForDate, verifyRunReceipt } from './run-receipt.mjs';
import { readReport } from './storage.mjs';
import { sha256, stableStringify } from './util.mjs';

export function evaluateReadiness({ report, outbox, runReceipt, requireChannel = null, deadlineMs = 20 * 60 * 1000 }) {
  if (!report)
    return readinessEnvelope({
      date: null,
      status: 'failed',
      checks: emptyChecks(),
      gaps: [{ code: 'report_missing', scope: 'content', severity: 'blocking' }]
    });

  const outcome = report.outcome ||
    deriveReportOutcome({
      selection: report.selection,
      analyses: report.items,
      sourceHealth: report.sourceHealth,
      evaluatedAt: report.generatedAt
    });
  const allMessages = outbox?.messages || [];
  const messages = allMessages.some((item) => item.reportDate)
    ? allMessages.filter((item) => item.reportDate === report.date)
    : allMessages;
  const channelMessages = requireChannel ? messages.filter((item) => item.channel === requireChannel) : messages;
  const deliveryCount = (status) => messages.filter((item) => item.status === status).length;
  const selectedDeliveryReady = requireChannel
    ? channelMessages.length === 1 && channelMessages[0].status === 'sent'
    : channelMessages.length > 0 && channelMessages.every((item) => item.status === 'sent');
  const deliveryReady =
    selectedDeliveryReady &&
    deliveryCount('pending') === 0 &&
    deliveryCount('retry_wait') === 0 &&
    deliveryCount('dispatching') === 0 &&
    deliveryCount('reconcile_required') === 0 &&
    deliveryCount('failed') === 0;
  const integrityReady = verifyReportIntegrity(report);
  const sloReady = Boolean(
    runReceipt &&
      verifyRunReceipt(runReceipt) &&
      ['completed', 'completed_with_gaps'].includes(runReceipt.status) &&
      Number.isFinite(runReceipt.durationMs) &&
      runReceipt.durationMs <= deadlineMs
  );
  const gaps = [...(outcome.gaps || [])];
  if (!deliveryReady)
    gaps.push({
      code: requireChannel ? 'required_channel_not_sent' : 'delivery_not_ready',
      scope: 'delivery',
      severity: 'blocking',
      channel: requireChannel || null
    });
  if (!integrityReady) gaps.push({ code: 'report_integrity_invalid', scope: 'integrity', severity: 'blocking' });
  if (!sloReady) gaps.push({ code: 'run_slo_not_verified', scope: 'slo', severity: 'blocking', deadlineMs });

  const checks = {
    content: {
      status:
        outcome.checks.quotas.status === 'completed' && outcome.checks.visuals.status === 'completed'
          ? 'completed'
          : 'completed_with_gaps',
      detail: { quotas: outcome.checks.quotas, visuals: outcome.checks.visuals }
    },
    sources: { status: outcome.checks.sources.status, detail: outcome.checks.sources },
    model: { status: outcome.checks.model.status, detail: outcome.checks.model },
    delivery: {
      status: deliveryReady ? 'completed' : 'completed_with_gaps',
      channel: requireChannel || null,
      sent: deliveryCount('sent'),
      pending: deliveryCount('pending'),
      retryWait: deliveryCount('retry_wait'),
      reconcileRequired: deliveryCount('reconcile_required'),
      failed: deliveryCount('failed')
    },
    integrity: { status: integrityReady ? 'completed' : 'completed_with_gaps' },
    slo: {
      status: sloReady ? 'completed' : 'completed_with_gaps',
      durationMs: Number.isFinite(runReceipt?.durationMs) ? runReceipt.durationMs : null,
      deadlineMs
    }
  };
  return readinessEnvelope({ date: report.date, status: gaps.length ? 'completed_with_gaps' : 'completed', checks, gaps });
}

export async function verifyPersistedRun(dataDir, { date, requireChannel = null, deadlineMs = 20 * 60 * 1000 } = {}) {
  const report = await readReport(dataDir, date);
  const outbox = await outboxStatus(dataDir, { includeReportIdentity: true });
  const runReceipt = await readRunReceiptForDate(dataDir, date);
  const readiness = evaluateReadiness({ report, outbox, runReceipt, requireChannel, deadlineMs });
  const files = report ? await verifyPersistedFiles(dataDir, report) : { status: 'failed', files: [] };
  if (files.status !== 'completed') {
    readiness.status = readiness.status === 'failed' ? 'failed' : 'completed_with_gaps';
    readiness.checks.integrity.status = 'completed_with_gaps';
    readiness.gaps.push({ code: 'persisted_files_invalid', scope: 'integrity.files', severity: 'blocking' });
  }
  readiness.persistedFiles = files;
  readiness.fingerprint = null;
  readiness.fingerprint = sha256(stableStringify(readiness));
  return readiness;
}

export function verifyReportIntegrity(report) {
  if (!report?.integrity?.contentSha256) return false;
  const expected = sha256(stableStringify({ ...report, integrity: { ...report.integrity, contentSha256: null } }));
  return expected === report.integrity.contentSha256;
}

async function verifyPersistedFiles(dataDir, report) {
  const manifestPath = path.join(dataDir, 'manifest.jsonl');
  const lines = await fs.readFile(manifestPath, 'utf8').catch((error) => (error.code === 'ENOENT' ? '' : Promise.reject(error)));
  const entries = lines
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const entry = entries.find((candidate) => candidate.reportId === report.id);
  if (!entry) return { status: 'failed', files: [] };
  const results = [];
  for (const file of entry.files || []) {
    const target = path.resolve(dataDir, file.path);
    const relative = path.relative(path.resolve(dataDir), target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      results.push({ path: file.path, status: 'invalid_path' });
      continue;
    }
    try {
      const content = await fs.readFile(target);
      results.push({
        path: file.path,
        status: content.length === file.sizeBytes && sha256(content) === file.sha256 ? 'completed' : 'hash_mismatch'
      });
    } catch (error) {
      results.push({ path: file.path, status: error.code === 'ENOENT' ? 'missing' : 'read_error' });
    }
  }
  return { status: results.length > 0 && results.every((file) => file.status === 'completed') ? 'completed' : 'failed', files: results };
}

function readinessEnvelope({ date, status, checks, gaps }) {
  const value = {
    schemaVersion: 'designsignal.readiness.v1',
    date,
    status,
    checks,
    gaps,
    fingerprint: null
  };
  value.fingerprint = sha256(stableStringify(value));
  return value;
}

function emptyChecks() {
  return Object.fromEntries(
    ['content', 'sources', 'model', 'delivery', 'integrity', 'slo'].map((name) => [name, { status: 'failed' }])
  );
}
