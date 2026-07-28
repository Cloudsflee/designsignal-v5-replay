import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { runDaily } from '../src/app.mjs';
import { resolveConfig } from '../src/config.mjs';

export async function temporaryDirectory(prefix = 'designsignal-test-') {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export function fixtureConfig(dataDir, overrides = {}) {
  return resolveConfig({
    fixture: true,
    dryRun: true,
    date: '2026-07-28',
    dataDir,
    ...overrides
  });
}

export async function fixtureReport(dataDir, overrides = {}) {
  return (await runDaily(fixtureConfig(dataDir, overrides))).report;
}
