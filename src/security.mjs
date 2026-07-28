import dns from 'node:dns/promises';
import https from 'node:https';
import { isIP } from 'node:net';
import { cleanText, sleep } from './util.mjs';

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export async function validatePublicUrl(input, { allowedHosts, resolver = defaultResolver } = {}) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw networkError('url_invalid');
  }
  if (url.protocol !== 'https:') throw networkError('https_required');
  if (url.username || url.password) throw networkError('url_credentials_forbidden');
  if (url.port && url.port !== '443') throw networkError('url_port_forbidden');
  const hostname = url.hostname.toLowerCase();
  if (!hostAllowed(hostname, allowedHosts || [])) throw networkError('host_not_allowed', { hostname });
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) throw networkError('private_network_forbidden');
  const addresses = await resolver(hostname);
  if (!addresses.length) throw networkError('dns_no_address', { hostname });
  if (addresses.some((entry) => !isPublicAddress(entry.address)))
    throw networkError('private_network_forbidden', { hostname });
  return { url, hostname, addresses };
}

export async function requestBytes(
  input,
  {
    allowedHosts,
    resolver = defaultResolver,
    timeoutMs = 12_000,
    maxBytes = 2_000_000,
    retries = 2,
    headers = {},
    method = 'GET',
    body = null,
    redirectLimit = 3,
    signal = null
  } = {}
) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await requestWithRedirects(input, {
        allowedHosts,
        resolver,
        timeoutMs,
        maxBytes,
        headers,
        method,
        body,
        redirectLimit,
        signal
      });
      if (RETRYABLE_STATUS.has(response.status) && attempt < retries) {
        await sleep(retryDelay(attempt, response.headers['retry-after']), signal);
        continue;
      }
      return { ...response, attempts: attempt + 1 };
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !retryable(error)) throw error;
      await sleep(retryDelay(attempt), signal);
    }
  }
  throw lastError;
}

async function requestWithRedirects(input, options) {
  let current = String(input);
  for (let redirects = 0; redirects <= options.redirectLimit; redirects += 1) {
    const target = await validatePublicUrl(current, options);
    const response = await singleRequest(target, options);
    if (![301, 302, 303, 307, 308].includes(response.status)) return { ...response, url: target.url.href, redirects };
    if (!['GET', 'HEAD'].includes(String(options.method || 'GET').toUpperCase()))
      throw networkError('redirect_for_method_forbidden');
    const location = response.headers.location;
    if (!location) throw networkError('redirect_location_missing');
    if (redirects === options.redirectLimit) throw networkError('redirect_limit_exceeded');
    current = new URL(location, target.url).href;
  }
  throw networkError('redirect_limit_exceeded');
}

function singleRequest(target, options) {
  const address = target.addresses[0];
  return new Promise((resolve, reject) => {
    let settled = false;
    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      reject(normalizeNetworkError(error));
    };
    const request = https.request(
      target.url,
      {
        method: options.method,
        headers: {
          accept: '*/*',
          'user-agent': 'DesignSignal/5.0 (+https://github.com/Cloudsflee/designsignal-v5-replay)',
          ...options.headers
        },
        servername: target.hostname,
        lookup(_hostname, lookupOptions, callback) {
          if (lookupOptions?.all) callback(null, target.addresses);
          else callback(null, address.address, address.family);
        }
      },
      (response) => {
        const contentLength = Number(response.headers['content-length']);
        if (Number.isFinite(contentLength) && contentLength > options.maxBytes) {
          response.destroy(networkError('response_too_large', { maxBytes: options.maxBytes }));
          return;
        }
        const chunks = [];
        let total = 0;
        response.on('data', (chunk) => {
          total += chunk.length;
          if (total > options.maxBytes) {
            response.destroy(networkError('response_too_large', { maxBytes: options.maxBytes }));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (settled) return;
          settled = true;
          resolve({
            status: Number(response.statusCode || 0),
            headers: normalizeHeaders(response.headers),
            bytes: Buffer.concat(chunks),
            dnsAddress: address.address
          });
        });
        response.on('error', finishReject);
      }
    );
    request.setTimeout(options.timeoutMs, () => request.destroy(networkError('request_timeout')));
    request.on('error', finishReject);
    if (options.signal) {
      const abort = () => request.destroy(options.signal.reason || networkError('request_aborted'));
      if (options.signal.aborted) abort();
      else options.signal.addEventListener('abort', abort, { once: true });
    }
    if (options.body != null) request.write(options.body);
    request.end();
  });
}

export async function readLimitedWebResponse(response, maximum) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maximum) throw networkError('response_too_large', { maxBytes: maximum });
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maximum) throw networkError('response_too_large', { maxBytes: maximum });
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximum) {
      await reader.cancel('response_too_large');
      throw networkError('response_too_large', { maxBytes: maximum });
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

function isPublicIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 255 && b === 255 && c === 255) return false;
  return true;
}

function isPublicIpv6(address) {
  const normalized = address.toLowerCase().split('%')[0];
  if (normalized === '::' || normalized === '::1') return false;
  if (normalized.startsWith('::ffff:')) return isPublicAddress(normalized.slice(7));
  if (/^f[cd]/.test(normalized)) return false;
  if (/^fe[89ab]/.test(normalized)) return false;
  if (normalized.startsWith('ff')) return false;
  return true;
}

export function hostAllowed(hostname, allowedHosts) {
  return (allowedHosts || []).some((entry) => {
    const normalized = String(entry || '').toLowerCase();
    if (normalized.startsWith('*.')) {
      const suffix = normalized.slice(1);
      return hostname.endsWith(suffix) && hostname.length > suffix.length;
    }
    return hostname === normalized;
  });
}

async function defaultResolver(hostname) {
  return dns.lookup(hostname, { all: true, verbatim: true });
}

function normalizeHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value.join(', ') : value || ''])
  );
}

function retryDelay(attempt, retryAfter) {
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(30_000, seconds * 1000);
  return Math.min(8000, 250 * 2 ** attempt);
}

function retryable(error) {
  return !['url_invalid', 'https_required', 'url_credentials_forbidden', 'url_port_forbidden', 'host_not_allowed', 'private_network_forbidden', 'response_too_large', 'redirect_for_method_forbidden'].includes(error?.code);
}

function normalizeNetworkError(error) {
  if (error?.code && String(error.code).startsWith('network_')) return error;
  const code = error?.code === 'ABORT_ERR' ? 'request_aborted' : cleanText(error?.code || 'request_failed', 100);
  return networkError(code, { cause: error });
}

function networkError(code, detail = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, detail);
  return error;
}
