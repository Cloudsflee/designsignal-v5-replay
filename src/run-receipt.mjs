import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWrite } from './storage.mjs';
import { deterministicId, publicError, sha256, stableStringify } from './util.mjs';

export const RUN_STAGES = Object.freeze(['collect', 'select', 'analyze', 'synthesize', 'persist', 'deliver', 'verify']);

export function createRunReceipt({ date, mode, startedAt, deadlineMs }) {
  return {
    schemaVersion: 'designsignal.run-receipt.v1',
    id: deterministicId('run', date, mode, startedAt),
    date,
    mode,
    status: 'running',
    startedAt,
    completedAt: null,
    durationMs: 0,
    deadlineMs,
    stages: RUN_STAGES.map((name) => ({
      name,
      status: 'pending',
      startedAt: null,
      completedAt: null,
      durationMs: 0,
      retries: 0,
      errorCode: null
    })),
    sourceSummary: null,
    report: null,
    delivery: null,
    error: null,
    fingerprint: null
  };
}

export async function runReceiptStage(receipt, name, operation, { now = () => new Date(), retries = 0 } = {}) {
  const stage = receipt.stages.find((entry) => entry.name === name);
  if (!stage) throw receiptError('run_stage_unknown');
  const started = now();
  stage.status = 'running';
  stage.startedAt = started.toISOString();
  stage.retries = Number(retries || 0);
  try {
    const value = await operation();
    const completed = now();
    stage.status = 'completed';
    stage.completedAt = completed.toISOString();
    stage.durationMs = Math.max(0, completed.getTime() - started.getTime());
    return value;
  } catch (error) {
    const completed = now();
    stage.status = 'failed';
    stage.completedAt = completed.toISOString();
    stage.durationMs = Math.max(0, completed.getTime() - started.getTime());
    stage.errorCode = publicError(error).code;
    throw error;
  }
}

export function skipRunStage(receipt, name, reason = 'not_applicable') {
  const stage = receipt.stages.find((entry) => entry.name === name);
  if (!stage || stage.status !== 'pending') return;
  stage.status = 'skipped';
  stage.errorCode = reason;
}

export function finalizeRunReceipt(receipt, { status, completedAt, error = null }) {
  receipt.status = status;
  receipt.completedAt = completedAt;
  receipt.durationMs = Math.max(0, new Date(completedAt).getTime() - new Date(receipt.startedAt).getTime());
  receipt.error = error ? { code: publicError(error).code } : null;
  receipt.fingerprint = null;
  receipt.fingerprint = sha256(stableStringify(receipt));
  return receipt;
}

export async function persistRunReceipt(dataDir, receipt) {
  const directory = path.join(dataDir, 'runs');
  const file = path.join(directory, `${receipt.date}-${receipt.id}.json`);
  const body = `${stableStringify(receipt, 2)}\n`;
  await atomicWrite(file, body, { overwrite: false });
  await atomicWrite(path.join(directory, 'latest.json'), body);
  return {
    ref: path.relative(dataDir, file).replaceAll('\\', '/'),
    sha256: sha256(body),
    sizeBytes: Buffer.byteLength(body)
  };
}

export async function readLatestRunReceipt(dataDir) {
  try {
    return assertRunReceipt(JSON.parse(await fs.readFile(path.join(dataDir, 'runs', 'latest.json'), 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function readRunReceiptForDate(dataDir, date) {
  const directory = path.join(dataDir, 'runs');
  const names = await fs.readdir(directory).catch((error) => (error.code === 'ENOENT' ? [] : Promise.reject(error)));
  const matches = names.filter((name) => name.startsWith(`${date}-run_`) && name.endsWith('.json')).sort();
  if (!matches.length) return null;
  return assertRunReceipt(JSON.parse(await fs.readFile(path.join(directory, matches.at(-1)), 'utf8')));
}

export function verifyRunReceipt(receipt) {
  return Boolean(
    receipt?.schemaVersion === 'designsignal.run-receipt.v1' &&
      /^[a-f0-9]{64}$/.test(receipt.fingerprint || '') &&
      sha256(stableStringify({ ...receipt, fingerprint: null })) === receipt.fingerprint &&
      RUN_STAGES.every((name, index) => receipt.stages?.[index]?.name === name)
  );
}

function assertRunReceipt(receipt) {
  if (!verifyRunReceipt(receipt)) throw receiptError('run_receipt_integrity_invalid');
  return receipt;
}

function receiptError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
