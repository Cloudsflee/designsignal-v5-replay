import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { analyzeSignals } from './analyze.mjs';
import { cacheSourceResponse } from './cache.mjs';
import { collectSignals } from './sources.mjs';
import { enqueueReportDeliveries, processOutbox } from './outbox.mjs';
import { buildDailyReport } from './report.mjs';
import { selectDailySignals } from './select.mjs';
import { persistReport, readHistory, withDateLock } from './storage.mjs';
import { SYLLABUS, SYLLABUS_SNAPSHOT_SHA256 } from './syllabus.mjs';
import { parseDateOnly } from './util.mjs';

export async function runCollect(config, options = {}) {
  const date = parseDateOnly(config.date, options.now?.() || new Date());
  const history = options.history || (config.mode === 'live' ? await readHistory(config.dataDir, 60) : []);
  const sources = options.sources || (config.sourcesPath ? await loadSources(config.sourcesPath) : undefined);
  const cacheWriter =
    options.cacheWriter ||
    (config.mode === 'live' && !config.dryRun
      ? (entry) => cacheSourceResponse(config.dataDir, entry)
      : null);
  const collection = await collectSignals(config, { ...options, date, sources, cacheWriter });
  const selection = selectDailySignals(collection, { date, history });
  return { date, collection, selection };
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
  const { collection, selection } = await runCollect(config, { ...options, date, now });
  const analyses = await analyzeSignals(selection.selected, config, { ...options, now });
  const report = buildDailyReport({
    date,
    collection,
    selection,
    analyses,
    generatedAt: now().toISOString()
  });
  if (config.dryRun) return { report, collection, selection, persistence: null, outbox: [] };
  const persistence = await persistReport(config.dataDir, report, { lock: !lockHeld });
  let outbox = [];
  if (!config.noPush) {
    outbox = await enqueueReportDeliveries(config.dataDir, report, options.environment);
    await processOutbox(config.dataDir, { environment: options.environment, now: options.now });
  }
  return { report, collection, selection, persistence, outbox };
}

async function loadSources(filePath) {
  const value = JSON.parse(await fs.readFile(path.resolve(filePath), 'utf8'));
  const sources = Array.isArray(value) ? value : value.sources;
  if (!Array.isArray(sources) || sources.some((item) => !item?.id || !item?.kind || !item?.category || !item?.url)) {
    const error = new Error('sources_file_invalid');
    error.code = 'sources_file_invalid';
    throw error;
  }
  return sources.map((item) => ({
    id: String(item.id).slice(0, 200),
    kind: String(item.kind).slice(0, 50),
    category: String(item.category).slice(0, 50),
    name: String(item.name || item.id).slice(0, 300),
    institution: item.institution ? String(item.institution).slice(0, 300) : null,
    url: String(item.url).slice(0, 2000),
    authority: item.authority ? String(item.authority).slice(0, 100) : undefined
  }));
}

export async function doctor(config) {
  const major = Number(process.versions.node.split('.')[0]);
  const checks = [
    { id: 'node', ok: major >= 24, detail: `Node ${process.versions.node}` },
    { id: 'runtime_dependencies', ok: true, detail: '0 production dependencies' },
    { id: 'syllabus', ok: SYLLABUS.edition === 'ZJU-IDI-2027', detail: SYLLABUS_SNAPSHOT_SHA256 },
    { id: 'commands', ok: true, detail: 'collect,daily,serve,doctor,outbox,schedule' },
    { id: 'allowed_hosts', ok: config.allowedHosts.length > 0, detail: `${config.allowedHosts.length} hosts` },
    {
      id: 'model_credentials',
      ok: true,
      detail: config.model && config.apiKey ? 'configured in memory' : 'optional; deterministic fallback active'
    }
  ];
  const parent = path.dirname(config.dataDir);
  try {
    const target = await fs.stat(config.dataDir).then(() => config.dataDir).catch((error) => {
      if (error.code === 'ENOENT') return parent;
      throw error;
    });
    await fs.access(target, fsConstants.W_OK);
    checks.push({ id: 'data_directory', ok: true, detail: `${target} is writable` });
  } catch (error) {
    checks.push({ id: 'data_directory', ok: false, detail: `${config.dataDir}: ${error.code || 'unavailable'}` });
  }
  return {
    schemaVersion: 'designsignal.doctor.v1',
    ok: checks.every((check) => check.ok),
    checks
  };
}
