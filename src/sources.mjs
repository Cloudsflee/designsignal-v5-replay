import { fixtureSignals } from './fixtures.mjs';
import { parseAllowlistedPage, parseArxivAtom, parseFeed, parseOpenAlex } from './parsers.mjs';
import { requestBytes } from './security.mjs';
import { cleanText, publicError, sha256, stableStringify } from './util.mjs';

export const DEFAULT_SOURCES = Object.freeze([
  {
    id: 'openalex-design-hci',
    kind: 'openalex',
    category: 'paper',
    name: 'OpenAlex Design & HCI',
    institution: 'OpenAlex',
    url: 'https://api.openalex.org/works?filter=from_publication_date:2026-01-01&search=design%20HCI%20AI&per-page=20'
  },
  {
    id: 'arxiv-hci-ai',
    kind: 'arxiv',
    category: 'paper',
    name: 'arXiv HCI & AI',
    institution: 'arXiv',
    url: 'https://export.arxiv.org/api/query?search_query=all:%22human-computer%20interaction%22%20AND%20all:AI&start=0&max_results=20&sortBy=submittedDate&sortOrder=descending'
  },
  {
    id: 'zju-idi',
    kind: 'page',
    category: 'frontier',
    name: '浙江大学 IDI',
    institution: '浙江大学',
    url: 'https://www.idi.zju.edu.cn/'
  },
  {
    id: 'tsinghua-design',
    kind: 'page',
    category: 'frontier',
    name: '清华大学设计动态',
    institution: '清华大学',
    url: 'https://www.tsinghua.edu.cn/'
  },
  {
    id: 'tongji-design',
    kind: 'page',
    category: 'frontier',
    name: '同济大学设计创意学院',
    institution: '同济大学',
    url: 'https://tjdi.tongji.edu.cn/'
  },
  {
    id: 'openai-research',
    kind: 'page',
    category: 'frontier',
    name: 'OpenAI Research',
    institution: 'OpenAI',
    url: 'https://openai.com/research/'
  },
  {
    id: 'deepmind-blog',
    kind: 'page',
    category: 'frontier',
    name: 'Google DeepMind',
    institution: 'Google DeepMind',
    url: 'https://deepmind.google/discover/blog/'
  },
  {
    id: 'microsoft-research',
    kind: 'page',
    category: 'frontier',
    name: 'Microsoft Research',
    institution: 'Microsoft Research',
    url: 'https://www.microsoft.com/en-us/research/'
  },
  {
    id: 'huggingface-blog',
    kind: 'page',
    category: 'frontier',
    name: 'Hugging Face Blog',
    institution: 'Hugging Face',
    url: 'https://huggingface.co/blog'
  },
  {
    id: 'core77-product',
    kind: 'page',
    category: 'product',
    name: 'Core77',
    institution: 'Core77',
    url: 'https://www.core77.com/'
  },
  {
    id: 'dezeen-product',
    kind: 'page',
    category: 'product',
    name: 'Dezeen',
    institution: 'Dezeen',
    url: 'https://www.dezeen.com/'
  },
  {
    id: 'designboom-product',
    kind: 'page',
    category: 'product',
    name: 'Designboom',
    institution: 'Designboom',
    url: 'https://www.designboom.com/'
  },
  {
    id: 'yanko-product',
    kind: 'page',
    category: 'product',
    name: 'Yanko Design',
    institution: 'Yanko Design',
    url: 'https://www.yankodesign.com/'
  },
  {
    id: 'awwwards-ui',
    kind: 'page',
    category: 'ui',
    name: 'Awwwards',
    institution: 'Awwwards',
    url: 'https://www.awwwards.com/'
  },
  {
    id: 'producthunt-ui',
    kind: 'page',
    category: 'ui',
    name: 'Product Hunt',
    institution: 'Product Hunt',
    url: 'https://www.producthunt.com/'
  }
]);

export async function collectSignals(config, options = {}) {
  if (config.mode === 'fixture') {
    const items = fixtureSignals(options.date);
    for (const item of items) {
      const snapshot = stableStringify({ ...item, provenance: undefined });
      item.provenance = {
        adapter: 'fixture',
        sourceUrl: item.url,
        fetchedAt: item.fetchedAt,
        responseSha256: sha256(snapshot),
        responseBytes: Buffer.byteLength(snapshot),
        responseMimeType: 'application/json',
        dnsAddress: null,
        attempts: 0,
        access: item.access,
        license: item.license
      };
      item.content = {
        ...item.content,
        bytes: Buffer.byteLength(snapshot),
        sha256: sha256(snapshot),
        cached: false
      };
    }
    return {
      schemaVersion: 'designsignal.collection.v1',
      mode: 'fixture',
      collectedAt: `${options.date}T15:50:00.000Z`,
      candidates: items,
      sourceHealth: items.map((item) => ({
        sourceId: item.source.id,
        sourceName: item.source.name,
        status: 'fixture',
        candidateCount: 1,
        fetchedAt: item.fetchedAt,
        latencyMs: 0,
        error: null
      })),
      rejected: []
    };
  }
  return collectLive(config, options);
}

export async function collectLive(
  config,
  { date, sources = DEFAULT_SOURCES, transport = requestBytes, cacheWriter = null, now = () => new Date() } = {}
) {
  const candidates = [];
  const sourceHealth = [];
  const rejected = [];
  for (const source of sources) {
    const started = Date.now();
    try {
      const response = await transport(source.url, {
        allowedHosts: config.allowedHosts,
        timeoutMs: config.timeoutMs,
        maxBytes: config.maxBytes,
        retries: config.retries,
        headers: source.kind === 'openalex' ? { accept: 'application/json' } : undefined
      });
      if (response.status < 200 || response.status >= 300) throw sourceError('source_http_error', { status: response.status });
      const fetchedAt = now().toISOString();
      const mimeType = cleanText(response.headers['content-type'], 200).split(';')[0];
      const parsed = parseSource(source, response.bytes, fetchedAt);
      await localizeVisualEvidence(parsed, source, config, { transport, cacheWriter, fetchedAt });
      const cached = cacheWriter
        ? await cacheWriter({
            source,
            bytes: response.bytes,
            fetchedAt,
            mimeType: mimeType || null,
            url: response.url || source.url,
            parsed
          })
        : null;
      for (const item of parsed) {
        item.provenance = {
          adapter: source.kind,
          sourceUrl: source.url,
          fetchedAt,
          responseSha256: sha256(response.bytes),
          responseBytes: response.bytes.length,
          responseMimeType: mimeType || null,
          dnsAddress: response.dnsAddress || null,
          attempts: response.attempts || 1,
          access: item.access,
          license: item.license
        };
        item.content = {
          ...item.content,
          mimeType: mimeType || item.content.mimeType,
          bytes: response.bytes.length,
          sha256: sha256(response.bytes),
          cached: Boolean(cached),
          cacheRef: cached?.blobRef || null
        };
        candidates.push(item);
      }
      sourceHealth.push({
        sourceId: source.id,
        sourceName: source.name,
        status: parsed.length ? 'healthy' : 'empty',
        candidateCount: parsed.length,
        fetchedAt,
        latencyMs: Date.now() - started,
        error: null
      });
    } catch (error) {
      const safe = publicError(error, [config.apiKey]);
      sourceHealth.push({
        sourceId: source.id,
        sourceName: source.name,
        status: 'degraded',
        candidateCount: 0,
        fetchedAt: now().toISOString(),
        latencyMs: Date.now() - started,
        error: safe
      });
      rejected.push({ sourceId: source.id, candidateId: null, reason: 'source_unavailable', detail: safe.code });
    }
  }
  return {
    schemaVersion: 'designsignal.collection.v1',
    mode: 'live',
    date,
    collectedAt: now().toISOString(),
    candidates,
    sourceHealth,
    rejected
  };
}

async function localizeVisualEvidence(items, source, config, { transport, cacheWriter, fetchedAt }) {
  for (const item of items.filter((candidate) => ['product', 'ui'].includes(candidate.category) && candidate.image?.url)) {
    if (String(item.image.url).startsWith('/')) continue;
    try {
      const response = await transport(item.image.url, {
        allowedHosts: config.allowedHosts,
        timeoutMs: config.timeoutMs,
        maxBytes: Math.min(5_000_000, Math.max(500_000, config.maxBytes)),
        retries: config.retries,
        headers: { accept: 'image/png,image/jpeg,image/webp,image/gif' }
      });
      const declared = cleanText(response.headers['content-type'], 200).split(';')[0];
      const mimeType = verifiedImageMime(response.bytes, declared);
      if (response.status < 200 || response.status >= 300 || !mimeType) throw sourceError('visual_response_invalid');
      const digest = sha256(response.bytes);
      const cached = cacheWriter
        ? await cacheWriter({
            source: { ...source, id: `${source.id}:visual`, kind: 'visual' },
            bytes: response.bytes,
            fetchedAt,
            mimeType,
            url: response.url || item.image.url,
            parsed: [item]
          })
        : null;
      item.image = {
        ...item.image,
        originalUrl: item.image.url,
        url: cached ? `/api/media/${digest}` : item.image.url,
        mimeType,
        sizeBytes: response.bytes.length,
        sha256: digest,
        cached: Boolean(cached)
      };
    } catch (error) {
      item.image = null;
      item.visualRejection = publicError(error);
    }
  }
}

function verifiedImageMime(bytes, declared) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return null;
  const hex = bytes.subarray(0, 12).toString('hex');
  const detected = hex.startsWith('89504e470d0a1a0a')
    ? 'image/png'
    : hex.startsWith('ffd8ff')
      ? 'image/jpeg'
      : hex.startsWith('474946383761') || hex.startsWith('474946383961')
        ? 'image/gif'
        : bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
          ? 'image/webp'
          : null;
  return detected && (!declared || declared === detected || (declared === 'image/jpg' && detected === 'image/jpeg'))
    ? detected
    : null;
}

export async function downloadOpenAccessPdf(item, config, { transport = requestBytes } = {}) {
  if (!item?.access?.openAccess || !item.access.pdfUrl) throw sourceError('pdf_open_access_required');
  if (!pdfLicenseAllowsDownload(item.license)) throw sourceError('pdf_license_required');
  const response = await transport(item.access.pdfUrl, {
    allowedHosts: config.allowedHosts,
    timeoutMs: config.timeoutMs,
    maxBytes: Math.min(25_000_000, Math.max(config.maxBytes, 10_000_000)),
    retries: config.retries,
    headers: { accept: 'application/pdf' }
  });
  const mimeType = cleanText(response.headers['content-type'], 200).split(';')[0];
  if (response.status !== 200 || mimeType !== 'application/pdf' || !response.bytes.subarray(0, 5).equals(Buffer.from('%PDF-')))
    throw sourceError('pdf_response_invalid');
  return {
    bytes: response.bytes,
    provenance: {
      url: item.access.pdfUrl,
      fetchedAt: new Date().toISOString(),
      mimeType,
      sizeBytes: response.bytes.length,
      sha256: sha256(response.bytes),
      accessStatus: item.access.status,
      licenseStatus: item.license?.status || 'unknown'
    }
  };
}

function pdfLicenseAllowsDownload(license) {
  const status = cleanText(license?.status, 100).toLowerCase();
  const name = cleanText(license?.name, 200).toLowerCase();
  if (status === 'repository_terms') return true;
  if (['public_domain', 'open_license'].includes(status)) return true;
  if (status !== 'declared') return false;
  return /^(cc0|cc[-\s]?by|creative commons)/i.test(name);
}

function parseSource(source, bytes, fetchedAt) {
  const text = bytes.toString('utf8');
  if (source.kind === 'openalex') return parseOpenAlex(text, { fetchedAt, category: source.category });
  if (source.kind === 'arxiv') return parseArxivAtom(text, { fetchedAt });
  if (source.kind === 'rss' || source.kind === 'atom') return parseFeed(text, { source, category: source.category, fetchedAt });
  if (source.kind === 'page') return parseAllowlistedPage(text, { source, category: source.category, fetchedAt });
  throw sourceError('source_adapter_unknown');
}

function sourceError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}
