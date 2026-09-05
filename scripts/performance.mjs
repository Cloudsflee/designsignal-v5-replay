import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { runDaily } from '../src/app.mjs';
import { startServer } from '../src/server.mjs';
import { fixtureConfig } from '../test/helpers.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'designsignal-v6-performance-'));
const fixtureTimes = [];
for (let index = 0; index < 20; index += 1) {
  const started = performance.now();
  await runDaily(fixtureConfig(path.join(root, `fixture-${index}`)));
  fixtureTimes.push(performance.now() - started);
}

const fallback = (await runDaily(fixtureConfig(path.join(root, 'server-fallback')))).report;
const service = await startServer({ ...fixtureConfig(path.join(root, 'server-data')), host: '127.0.0.1', port: 0 }, { fallbackReport: fallback });
const apiTimes = [];
try {
  const routes = ['/healthz', '/api/reports/latest', '/api/readiness', '/api/outbox', '/api/sources/health'];
  for (let index = 0; index < 100; index += 1) {
    const route = routes[index % routes.length];
    const started = performance.now();
    const response = await fetch(`${service.url}${route}`);
    if (!response.ok) throw new Error(`performance_route_${response.status}`);
    await response.arrayBuffer();
    apiTimes.push(performance.now() - started);
  }
} finally {
  await service.close();
  await fs.rm(root, { recursive: true, force: true });
}

const result = {
  schemaVersion: 'designsignal.performance.v1',
  fixture: summarize(fixtureTimes, 1500),
  coreGetApi: summarize(apiTimes, 200),
  pass: percentile(fixtureTimes, 0.95) <= 1500 && percentile(apiTimes, 0.95) <= 200
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.pass) process.exitCode = 1;

function percentile(values, quantile) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))] || 0;
}

function summarize(values, thresholdMs) {
  return {
    samples: values.length,
    p50Ms: Number(percentile(values, 0.5).toFixed(3)),
    p95Ms: Number(percentile(values, 0.95).toFixed(3)),
    maxMs: Number(Math.max(...values).toFixed(3)),
    thresholdMs,
    pass: percentile(values, 0.95) <= thresholdMs
  };
}
