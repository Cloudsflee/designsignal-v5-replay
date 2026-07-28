import path from 'node:path';
import { cleanText } from './util.mjs';

export const DEFAULT_QUOTAS = Object.freeze({ paper: 2, product: 1, ui: 1, frontier: 2 });
export const DEFAULT_ALLOWED_HOSTS = Object.freeze([
  'api.openalex.org',
  'export.arxiv.org',
  'arxiv.org',
  'www.idi.zju.edu.cn',
  'www.tsinghua.edu.cn',
  'www.tongji.edu.cn',
  'tjdi.tongji.edu.cn',
  'dl.acm.org',
  'www.core77.com',
  'www.dezeen.com',
  'www.designboom.com',
  'www.yankodesign.com',
  'www.awwwards.com',
  'www.producthunt.com',
  'openai.com',
  'deepmind.google',
  'www.microsoft.com',
  'huggingface.co'
]);

export function parseCli(argv = process.argv.slice(2)) {
  const [command = 'help', ...tokens] = argv;
  const options = {};
  const positional = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const equals = token.indexOf('=');
    if (equals > 2) {
      options[toCamel(token.slice(2, equals))] = token.slice(equals + 1);
      continue;
    }
    const key = toCamel(token.slice(2));
    const following = tokens[index + 1];
    if (following && !following.startsWith('--')) {
      options[key] = following;
      index += 1;
    } else options[key] = true;
  }
  return { command, options, positional };
}

export function resolveConfig(options = {}, environment = process.env) {
  const dataDir = path.resolve(
    cleanText(options.dataDir || environment.DESIGNSIGNAL_DATA_DIR, 1000) || path.join(process.cwd(), 'data')
  );
  const allowedHosts = uniqueHosts(
    cleanText(options.allowedHosts || environment.DESIGNSIGNAL_ALLOWED_HOSTS, 10_000)
      .split(',')
      .filter(Boolean)
  );
  return {
    mode: options.fixture ? 'fixture' : 'live',
    dryRun: Boolean(options.dryRun),
    date: options.date || null,
    dataDir,
    port: boundedInteger(options.port || environment.PORT || environment.DESIGNSIGNAL_PORT, 3379, 1, 65_535),
    host: cleanText(options.host || environment.DESIGNSIGNAL_HOST, 255) || '127.0.0.1',
    timeoutMs: boundedInteger(options.timeoutMs || environment.DESIGNSIGNAL_TIMEOUT_MS, 12_000, 100, 120_000),
    retries: boundedInteger(options.retries || environment.DESIGNSIGNAL_RETRIES, 2, 0, 5),
    maxBytes: boundedInteger(options.maxBytes || environment.DESIGNSIGNAL_MAX_BYTES, 2_000_000, 1024, 25_000_000),
    allowedHosts: allowedHosts.length ? allowedHosts : [...DEFAULT_ALLOWED_HOSTS],
    noPush: Boolean(options.noPush),
    once: Boolean(options.once),
    json: Boolean(options.json),
    codexConfigPath: cleanText(options.codexConfig || environment.DESIGNSIGNAL_CODEX_CONFIG, 1000) || null,
    sourcesPath: cleanText(options.sources || environment.DESIGNSIGNAL_SOURCES_FILE, 1000) || null,
    model: cleanText(options.model || environment.DESIGNSIGNAL_MODEL || environment.OPENAI_MODEL, 200) || null,
    baseUrl:
      cleanText(options.baseUrl || environment.DESIGNSIGNAL_OPENAI_BASE_URL || environment.OPENAI_BASE_URL, 1000) ||
      'https://api.openai.com/v1',
    apiKey: environment.DESIGNSIGNAL_OPENAI_API_KEY || environment.OPENAI_API_KEY || null
  };
}

export function publicConfig(config) {
  return {
    mode: config.mode,
    dryRun: config.dryRun,
    dataDir: config.dataDir,
    host: config.host,
    port: config.port,
    timeoutMs: config.timeoutMs,
    retries: config.retries,
    maxBytes: config.maxBytes,
    allowedHostCount: config.allowedHosts.length,
    sourcesFileConfigured: Boolean(config.sourcesPath),
    modelConfigured: Boolean(config.model && config.apiKey),
    pushConfigured: Boolean(
      process.env.DESIGNSIGNAL_WEBHOOK_URL || process.env.FEISHU_WEBHOOK_URL || process.env.WECOM_WEBHOOK_URL
    )
  };
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function uniqueHosts(values) {
  return [...new Set(values.map((value) => cleanText(value, 253).toLowerCase()).filter(validHost))];
}

function validHost(value) {
  return Boolean(value && !value.includes('/') && !value.includes(':') && /^[a-z0-9.-]+$/.test(value));
}
