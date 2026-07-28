import { createHash } from 'node:crypto';

export const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function stableStringify(value, space = 0) {
  return JSON.stringify(sortValue(value), null, space);
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortValue(value[key])])
  );
}

export function deterministicId(prefix, ...parts) {
  return `${prefix}_${sha256(parts.map((part) => String(part ?? '')).join('\0')).slice(0, 20)}`;
}

export function shanghaiParts(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('invalid_date');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

export function shanghaiDate(value = new Date()) {
  const parts = shanghaiParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function shanghaiTimestamp(value = new Date()) {
  const parts = shanghaiParts(value);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+08:00`;
}

export function parseDateOnly(value, fallback = new Date()) {
  const text = String(value || '').trim();
  if (!text) return shanghaiDate(fallback);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new TypeError('date_must_be_yyyy_mm_dd');
  const parsed = new Date(`${text}T00:00:00+08:00`);
  if (Number.isNaN(parsed.getTime()) || shanghaiDate(parsed) !== text) throw new TypeError('invalid_calendar_date');
  return text;
}

export function sleep(milliseconds, signal) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    if (!signal) return;
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason || new Error('aborted'));
    };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

export function cleanText(value, maximum = 20_000) {
  return String(value ?? '')
    .replace(/\0/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, maximum);
}

export function uniqueStrings(values, maximum = 2000) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => cleanText(value, maximum)).filter(Boolean))];
}

export function clamp(value, minimum = 0, maximum = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return minimum;
  return Math.min(maximum, Math.max(minimum, number));
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character];
  });
}

export function redactSecrets(value, secrets = []) {
  let text = String(value ?? '');
  for (const secret of secrets.map(String).filter((item) => item.length >= 6)) text = text.split(secret).join('[REDACTED]');
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{8,}/gi, 'Bearer [REDACTED]')
    .replace(/\b(sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/g, '$1-[REDACTED]')
    .replace(/([?&](?:token|key|secret|signature)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/("(?:api[_-]?key|token|secret|password)"\s*:\s*")[^"]+("?)/gi, '$1[REDACTED]$2');
}

export function publicError(error, secrets = []) {
  return {
    code: cleanText(error?.code || error?.name || 'error', 100),
    message: redactSecrets(cleanText(error?.message || String(error), 1000), secrets)
  };
}

export function assert(condition, code, details = {}) {
  if (condition) return;
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

export function jsonClone(value) {
  return structuredClone(value);
}
