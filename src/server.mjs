import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDashboard } from './dashboard.mjs';
import { outboxStatus } from './outbox.mjs';
import { nextShanghaiRun } from './scheduler.mjs';
import { appendManifest, readLatestReport, readReport } from './storage.mjs';
import { SYLLABUS } from './syllabus.mjs';
import { cleanText, publicError, shanghaiDate } from './util.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staticFiles = new Map([
  ['/assets/styles.css', { path: path.join(root, 'assets', 'styles.css'), type: 'text/css; charset=utf-8' }],
  ['/assets/app.js', { path: path.join(root, 'assets', 'app.js'), type: 'text/javascript; charset=utf-8' }],
  ['/assets/product-signal.png', { path: path.join(root, 'assets', 'product-signal.png'), type: 'image/png' }],
  ['/assets/ui-signal.png', { path: path.join(root, 'assets', 'ui-signal.png'), type: 'image/png' }]
]);

export async function startServer(config, { fallbackReport = null, now = () => new Date() } = {}) {
  const startedAt = now();
  const server = http.createServer(async (request, response) => {
    setSecurityHeaders(response);
    try {
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      if (request.method === 'GET' && staticFiles.has(url.pathname)) return serveStatic(response, staticFiles.get(url.pathname));
      const mediaMatch = /^\/api\/media\/([a-f0-9]{64})$/.exec(url.pathname);
      if (request.method === 'GET' && mediaMatch) return serveCachedMedia(response, config.dataDir, mediaMatch[1]);
      if (request.method === 'GET' && url.pathname === '/healthz') {
        const report = (await readLatestReport(config.dataDir)) || fallbackReport;
        const storageWritable = await writableDataPath(config.dataDir);
        return json(response, storageWritable ? 200 : 503, {
          status: storageWritable ? 'ok' : 'degraded',
          version: '5.0.0',
          uptimeSeconds: Math.floor((now().getTime() - startedAt.getTime()) / 1000),
          timeZone: 'Asia/Shanghai',
          nextRunAt: nextShanghaiRun(now()).toISOString(),
          latestReportDate: report?.date || null,
          mode: config.mode,
          storageWritable
        });
      }
      if (request.method === 'GET' && url.pathname === '/api/reports/latest') {
        const report = (await readLatestReport(config.dataDir)) || fallbackReport;
        return report ? json(response, 200, report) : json(response, 404, { error: 'report_not_found' });
      }
      const reportMatch = /^\/api\/reports\/(\d{4}-\d{2}-\d{2})$/.exec(url.pathname);
      if (request.method === 'GET' && reportMatch) {
        const report = await readReport(config.dataDir, reportMatch[1]);
        return report ? json(response, 200, report) : json(response, 404, { error: 'report_not_found' });
      }
      if (request.method === 'GET' && url.pathname === '/api/syllabus') return json(response, 200, SYLLABUS);
      if (request.method === 'GET' && url.pathname === '/api/sources/health') {
        const report = (await readLatestReport(config.dataDir)) || fallbackReport;
        return json(response, 200, { date: report?.date || null, items: report?.sourceHealth || [] });
      }
      if (request.method === 'GET' && url.pathname === '/api/outbox') return json(response, 200, await outboxStatus(config.dataDir));
      if (request.method === 'POST' && url.pathname === '/api/feedback') {
        const input = await readJsonBody(request, 64 * 1024);
        if (!['useful', 'not_useful'].includes(input.rating)) return json(response, 400, { error: 'feedback_rating_invalid' });
        const feedback = {
          schemaVersion: 'designsignal.feedback.v1',
          reportDate: cleanText(input.reportDate, 10) || shanghaiDate(now()),
          rating: input.rating,
          note: cleanText(input.note, 1000),
          createdAt: now().toISOString()
        };
        await appendManifest(path.join(config.dataDir, 'feedback', `${feedback.reportDate}.jsonl`), feedback);
        return json(response, 201, { accepted: true });
      }
      if (request.method === 'GET' && url.pathname === '/') {
        const report = (await readLatestReport(config.dataDir)) || fallbackReport;
        const outbox = await outboxStatus(config.dataDir);
        return html(response, 200, renderDashboard(report, { outbox }));
      }
      return json(response, 404, { error: 'route_not_found' });
    } catch (error) {
      const status = error.code === 'request_body_too_large' ? 413 : error.code === 'request_json_invalid' ? 400 : 500;
      return json(response, status, { error: publicError(error).code });
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  });
  return {
    server,
    url: `http://${config.host}:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

async function writableDataPath(dataDir) {
  try {
    const target = await fs.stat(dataDir).then(() => dataDir).catch((error) => {
      if (error.code === 'ENOENT') return path.dirname(dataDir);
      throw error;
    });
    await fs.access(target, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function serveStatic(response, file) {
  const content = await fs.readFile(file.path);
  response.writeHead(200, {
    'content-type': file.type,
    'content-length': content.length,
    'cache-control': file.type.startsWith('image/') ? 'public, max-age=86400, immutable' : 'public, max-age=300',
    'x-content-type-options': 'nosniff'
  });
  response.end(content);
}

async function serveCachedMedia(response, dataDir, digest) {
  const content = await fs.readFile(path.join(dataDir, 'cache', 'blobs', digest.slice(0, 2), digest));
  const type = imageMime(content);
  if (!type) {
    const error = new Error('cached_media_invalid');
    error.code = 'cached_media_invalid';
    throw error;
  }
  response.writeHead(200, {
    'content-type': type,
    'content-length': content.length,
    'cache-control': 'public, max-age=31536000, immutable',
    etag: `"${digest}"`,
    'x-content-type-options': 'nosniff'
  });
  response.end(content);
}

function imageMime(bytes) {
  const hex = bytes.subarray(0, 12).toString('hex');
  if (hex.startsWith('89504e470d0a1a0a')) return 'image/png';
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex.startsWith('474946383761') || hex.startsWith('474946383961')) return 'image/gif';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP')
    return 'image/webp';
  return null;
}

function setSecurityHeaders(response) {
  response.setHeader(
    'content-security-policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
  );
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-frame-options', 'DENY');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  response.setHeader('cross-origin-opener-policy', 'same-origin');
}

function json(response, status, value) {
  const body = Buffer.from(`${safeJsonStringify(value)}\n`);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store'
  });
  response.end(body);
}

function safeJsonStringify(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => {
    return {
      '<': '\\u003c',
      '>': '\\u003e',
      '&': '\\u0026',
      '\u2028': '\\u2028',
      '\u2029': '\\u2029'
    }[character];
  });
}

function html(response, status, value) {
  const body = Buffer.from(value);
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store'
  });
  response.end(body);
}

async function readJsonBody(request, maximum) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maximum) {
      const error = new Error('request_body_too_large');
      error.code = 'request_body_too_large';
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('request_json_invalid');
    error.code = 'request_json_invalid';
    throw error;
  }
}
