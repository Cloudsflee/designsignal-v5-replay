import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { analyzeSignals } from './analyze.mjs';
import { cacheSourceResponse } from './cache.mjs';
import { outboxStatus, enqueueReportDeliveries, processOutbox } from './outbox.mjs';
import { evaluateReadiness, verifyReportIntegrity } from './readiness.mjs';
import { buildDailyReport } from './report.mjs';
import {
  createRunReceipt,
  finalizeRunReceipt,
  persistRunReceipt,
  runReceiptStage,
  skipRunStage
} from './run-receipt.mjs';
import { selectDailySignals } from './select.mjs';
import { collectSignals, DEFAULT_SOURCE_CATALOG, normalizeSourceDefinitions } from './sources.mjs';
import { persistReport, readHistory, withDateLock } from './storage.mjs';
import { SYLLABUS, SYLLABUS_SNAPSHOT_SHA256 } from './syllabus.mjs';
import { parseDateOnly, publicError } from './util.mjs';

export async function runCollect(config, options = {}) {
  const date = parseDateOnly(config.date, options.now?.() || new Date());
  const now = options.now || (() => new Date());
  const prepared = await collectForDate({ ...config, date }, { ...options, now });
  const selection = selectDailySignals(prepared.collection, { date, history: prepared.history });
  return { date, collection: prepared.collection, selection };
}

export async function runDaily(config, options = {}) {
  const date = parseDateOnly(config.date, options.now?.() || new Date());
  if (!config.dryRun)
    return withDateLock(config.dataDir, date, () => executeDaily({ ...config, date }, options, { lockHeld: true }));
  return executeDaily({ ...config, date }, options, { lockHeld: false });
}

async function executeDaily(config, options, { lockHeld }) {
  const date = config.date;
  const deterministicNow = () => new Date(`${date}T15:50:00.000Z`);
  const now = config.mode === 'fixture' ? deterministicNow : options.now || (() => new Date());
  const deadline = createRunDeadline(config, options.signal);
  const receipt = createRunReceipt({
    date,
    mode: config.mode,
    startedAt: now().toISOString(),
    deadlineMs: config.liveDeadlineMs
  });
  let collection;
  let selection;
  let report;
  let persistence = null;
  let queued = [];
  try {
    const prepared = await runReceiptStage(
      receipt,
      'collect',
      async () => {
        assertWithinDeadline(deadline.signal);
        return collectForDate(config, { ...options, date, now, signal: deadline.signal });
      },
      { now }
    );
    collection = prepared.collection;
    receipt.sourceSummary = summarizeSources(collection);
    receipt.stages.find((stage) => stage.name === 'collect').retries = collection.candidates.reduce(
      (sum, item) => sum + Math.max(0, Number(item.provenance?.attempts || 1) - 1),
      0
    );

    selection = await runReceiptStage(
      receipt,
      'select',
      async () => {
        assertWithinDeadline(deadline.signal);
        return selectDailySignals(collection, { date, history: prepared.history });
      },
      { now }
    );

    const analyses = await runReceiptStage(
      receipt,
      'analyze',
      async () => {
        assertWithinDeadline(deadline.signal);
        return analyzeSignals(selection.selected, config, { ...options, now, signal: deadline.signal });
      },
      { now }
    );
    receipt.stages.find((stage) => stage.name === 'analyze').retries = analyses.filter(
      (item) => item.analysis?.model?.status === 'failed_fallback'
    ).length;

    report = await runReceiptStage(
      receipt,
      'synthesize',
      async () => {
        assertWithinDeadline(deadline.signal);
        return buildDailyReport({ date, collection, selection, analyses, generatedAt: now().toISOString() });
      },
      { now }
    );
    receipt.report = {
      id: report.id,
      date: report.date,
      schemaVersion: report.schemaVersion,
      ref: `reports/${report.date}/report.json`,
      integritySha256: report.integrity.contentSha256
    };

    if (config.dryRun) {
      skipRunStage(receipt, 'persist', 'dry_run');
      skipRunStage(receipt, 'deliver', config.noPush ? 'push_disabled' : 'dry_run');
      await runReceiptStage(
        receipt,
        'verify',
        async () => {
          if (!verifyReportIntegrity(report)) throw runError('report_integrity_invalid');
          return true;
        },
        { now }
      );
      finalizeRunReceipt(receipt, { status: report.outcome.status, completedAt: now().toISOString() });
      return { report, collection, selection, persistence: null, outbox: [], receipt, readiness: null };
    }

    persistence = await runReceiptStage(
      receipt,
      'persist',
      async () => {
        assertWithinDeadline(deadline.signal);
        return persistReport(config.dataDir, report, { lock: !lockHeld });
      },
      { now }
    );

    if (config.noPush) {
      skipRunStage(receipt, 'deliver', 'push_disabled');
    } else {
      queued = await runReceiptStage(
        receipt,
        'deliver',
        async () => {
          assertWithinDeadline(deadline.signal);
          const messages = await enqueueReportDeliveries(config.dataDir, report, options.environment);
          await processOutbox(config.dataDir, {
            environment: options.environment,
            now,
            transport: options.transport,
            signal: deadline.signal
          });
          return messages;
        },
        { now }
      );
    }

    const delivery = await outboxStatus(config.dataDir, { includeReportIdentity: true });
    receipt.delivery = summarizeDelivery(delivery, report.date);
    await runReceiptStage(
      receipt,
      'verify',
      async () => {
        assertWithinDeadline(deadline.signal);
        if (!verifyReportIntegrity(report)) throw runError('report_integrity_invalid');
        if (!persistence?.manifestEntry?.files?.length) throw runError('report_manifest_missing');
        return true;
      },
      { now }
    );

    finalizeRunReceipt(receipt, { status: report.outcome.status, completedAt: now().toISOString() });
    const readiness = evaluateReadiness({
      report,
      outbox: delivery,
      runReceipt: receipt,
      requireChannel: config.requiredChannel,
      deadlineMs: config.liveDeadlineMs
    });
    finalizeRunReceipt(receipt, { status: readiness.status, completedAt: receipt.completedAt });
    const receiptPersistence = await persistRunReceipt(config.dataDir, receipt);
    return { report, collection, selection, persistence, outbox: queued, receipt, receiptPersistence, readiness };
  } catch (error) {
    finalizeRunReceipt(receipt, { status: 'failed', completedAt: now().toISOString(), error });
    if (!config.dryRun) {
      try {
        await persistRunReceipt(config.dataDir, receipt);
      } catch (receiptError) {
        error.receiptError = publicError(receiptError);
      }
    }
    throw error;
  } finally {
    deadline.close();
  }
}

async function collectForDate(config, options) {
  const date = config.date;
  const history = options.history ?? (config.mode === 'live' ? await readHistory(config.dataDir, 60) : []);
  const sources = options.sources ?? (config.sourcesPath ? await loadSources(config.sourcesPath) : undefined);
  const cacheWriter =
    options.cacheWriter ??
    (config.mode === 'live' && !config.dryRun ? (entry) => cacheSourceResponse(config.dataDir, entry) : null);
  const collection = await collectSignals(config, { ...options, date, sources, cacheWriter });
  return { collection, history };
}

async function loadSources(filePath) {
  const value = JSON.parse(await fs.readFile(path.resolve(filePath), 'utf8'));
  if (value?.schemaVersion && value.schemaVersion !== 'designsignal.sources.v2') throw runError('sources_schema_version_invalid');
  return normalizeSourceDefinitions(value);
}

function createRunDeadline(config, parentSignal) {
  if (config.mode !== 'live') return { signal: parentSignal || null, close() {} };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(runError('run_deadline_exceeded')), config.liveDeadlineMs);
  timeout.unref?.();
  const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
  return { signal, close: () => clearTimeout(timeout) };
}

function assertWithinDeadline(signal) {
  if (!signal?.aborted) return;
  throw signal.reason?.code ? signal.reason : runError('run_deadline_exceeded');
}

function summarizeSources(collection) {
  const health = collection?.sourceHealth || [];
  return {
    catalogSchemaVersion: collection?.sourceCatalog?.schemaVersion || null,
    catalogFingerprint: collection?.sourceCatalog?.fingerprint || null,
    total: health.length,
    required: health.filter((item) => item.required).length,
    healthy: health.filter((item) => ['healthy', 'fixture'].includes(item.status)).length,
    degraded: health.filter((item) => item.status === 'degraded').length,
    candidates: collection?.candidates?.length || 0,
    errorCodes: [...new Set(health.flatMap((item) => item.errorCodes || (item.error?.code ? [item.error.code] : [])))].sort()
  };
}

function summarizeDelivery(status, reportDate) {
  const messages = status.messages.filter((message) => !message.reportDate || message.reportDate === reportDate);
  const count = (value) => messages.filter((message) => message.status === value).length;
  return {
    total: messages.length,
    pending: count('pending'),
    dispatching: count('dispatching'),
    sent: count('sent'),
    retryWait: count('retry_wait'),
    reconcileRequired: count('reconcile_required'),
    failed: count('failed'),
    channels: messages.map((message) => ({ id: message.id, channel: message.channel, status: message.status }))
  };
}

export async function doctor(config) {
  const major = Number(process.versions.node.split('.')[0]);
  const checks = [
    { id: 'node', ok: major >= 24, detail: `Node ${process.versions.node}` },
    { id: 'runtime_dependencies', ok: true, detail: '0 production dependencies' },
    { id: 'syllabus', ok: SYLLABUS.edition === 'ZJU-IDI-2027', detail: SYLLABUS_SNAPSHOT_SHA256 },
    { id: 'sources', ok: DEFAULT_SOURCE_CATALOG.schemaVersion === 'designsignal.sources.v2', detail: `${DEFAULT_SOURCE_CATALOG.sources.length} sources` },
    { id: 'commands', ok: true, detail: 'collect,daily,serve,doctor,outbox,reconcile,verify,schedule' },
    { id: 'allowed_hosts', ok: config.allowedHosts.length > 0, detail: `${config.allowedHosts.length} hosts` },
    { id: 'deadline', ok: config.liveDeadlineMs <= 20 * 60 * 1000, detail: `${config.liveDeadlineMs} ms` },
    {
      id: 'model_credentials',
      ok: true,
      detail: config.model && config.apiKey ? 'configured in memory' : 'not configured; Live verification remains incomplete'
    },
    {
      id: 'feishu_webhook',
      ok: true,
      detail: process.env.FEISHU_WEBHOOK_URL ? 'configured in memory' : 'not configured; Live verification remains incomplete'
    }
  ];
  const parent = path.dirname(config.dataDir);
  try {
    const target = await fs.stat(config.dataDir).then(() => config.dataDir).catch((error) => {
      if (error.code === 'ENOENT') return parent;
      throw error;
    });
    await fs.access(target, fsConstants.W_OK);
    checks.push({ id: 'data_directory', ok: true, detail: 'writable' });
  } catch (error) {
    checks.push({ id: 'data_directory', ok: false, detail: error.code || 'unavailable' });
  }
  return {
    schemaVersion: 'designsignal.doctor.v2',
    ok: checks.every((check) => check.ok),
    checks
  };
}

function runError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
