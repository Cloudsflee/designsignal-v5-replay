import { fixtureSignals } from './fixtures.mjs';
import { parseAllowlistedPage, parseArxivAtom, parseFeed, parseListingLinks, parseOpenAlex } from './parsers.mjs';
import { requestBytes } from './security.mjs';
import { cleanText, publicError, sha256, stableStringify } from './util.mjs';

export const DEFAULT_SOURCE_CATALOG = Object.freeze({
  schemaVersion: 'designsignal.sources.v2',
  sources: Object.freeze([
  {
    id: 'openalex-design-hci',
    kind: 'openalex',
    adapter: 'openalex',
    category: 'paper',
    name: 'OpenAlex Design & HCI',
    institution: 'OpenAlex',
    url: 'https://api.openalex.org/works?filter=from_publication_date:2026-01-01&search=design%20HCI%20AI&per-page=20',
    required: true,
    maxDetailPages: 0,
    visualEvidenceRequired: false
  },
  {
    id: 'arxiv-hci-ai',
    kind: 'arxiv',
    adapter: 'arxiv',
    category: 'paper',
    name: 'arXiv HCI & AI',
    institution: 'arXiv',
    url: 'https://export.arxiv.org/api/query?search_query=all:%22human-computer%20interaction%22%20AND%20all:AI&start=0&max_results=20&sortBy=submittedDate&sortOrder=descending',
    required: false,
    maxDetailPages: 0,
    visualEvidenceRequired: false
  },
  {
    id: 'core77-product',
    kind: 'page',
    adapter: 'listing',
    category: 'product',
    name: 'Core77',
    institution: 'Core77',
    url: 'https://www.core77.com/news',
    required: true,
    maxDetailPages: 3,
    detailPathPrefixes: ['/posts/'],
    visualEvidenceRequired: true
  },
  {
    id: 'designboom-product',
    kind: 'page',
    adapter: 'listing',
    category: 'product',
    name: 'Designboom',
    institution: 'Designboom',
    url: 'https://www.designboom.com/design/',
    required: false,
    maxDetailPages: 3,
    detailPathPrefixes: ['/design/'],
    visualEvidenceRequired: true
  },
  {
    id: 'yanko-product',
    kind: 'page',
    adapter: 'listing',
    category: 'product',
    name: 'Yanko Design',
    institution: 'Yanko Design',
    url: 'https://www.yankodesign.com/',
    required: false,
    maxDetailPages: 3,
    detailPathPrefixes: ['/2026/'],
    visualEvidenceRequired: true
  },
  {
    id: 'awwwards-ui',
    kind: 'page',
    adapter: 'listing',
    category: 'ui',
    name: 'Awwwards',
    institution: 'Awwwards',
    url: 'https://www.awwwards.com/websites/',
    required: true,
    maxDetailPages: 3,
    detailPathPrefixes: ['/sites/'],
    visualEvidenceRequired: true
  },
  {
    id: 'producthunt-ui',
    kind: 'page',
    adapter: 'listing',
    category: 'ui',
    name: 'Product Hunt',
    institution: 'Product Hunt',
    url: 'https://www.producthunt.com/',
    required: false,
    maxDetailPages: 3,
    detailPathPrefixes: ['/posts/'],
    visualEvidenceRequired: true
  },
  {
    id: 'dezeen-ui',
    kind: 'page',
    adapter: 'listing',
    category: 'ui',
    name: 'Dezeen',
    institution: 'Dezeen',
    url: 'https://www.dezeen.com/design/',
    required: false,
    maxDetailPages: 3,
    detailPathPrefixes: ['/2026/'],
    visualEvidenceRequired: true
  },
  {
    id: 'openai-research',
    kind: 'page',
    adapter: 'listing',
    category: 'frontier',
    name: 'OpenAI Research',
    institution: 'OpenAI',
    url: 'https://openai.com/research/',
    required: true,
    maxDetailPages: 3,
    detailPathPrefixes: ['/index/', '/research/'],
    visualEvidenceRequired: false
  },
  {
    id: 'deepmind-blog',
    kind: 'page',
    adapter: 'listing',
    category: 'frontier',
    name: 'Google DeepMind',
    institution: 'Google DeepMind',
    url: 'https://deepmind.google/discover/blog/',
    required: false,
    maxDetailPages: 3,
    detailPathPrefixes: ['/discover/blog/'],
    visualEvidenceRequired: false
  },
  {
    id: 'microsoft-research',
    kind: 'page',
    adapter: 'listing',
    category: 'frontier',
    name: 'Microsoft Research',
    institution: 'Microsoft Research',
    url: 'https://www.microsoft.com/en-us/research/blog/',
    required: false,
    maxDetailPages: 3,
    detailPathPrefixes: ['/en-us/research/blog/'],
    visualEvidenceRequired: false
  },
  {
    id: 'huggingface-blog',
    kind: 'page',
    adapter: 'listing',
    category: 'frontier',
    name: 'Hugging Face Blog',
    institution: 'Hugging Face',
    url: 'https://huggingface.co/blog',
    required: false,
    maxDetailPages: 3,
    detailPathPrefixes: ['/blog/'],
    visualEvidenceRequired: false
  },
  {
    id: 'tsinghua-frontier',
    kind: 'page',
    adapter: 'listing',
    category: 'frontier',
    name: '清华大学研究动态',
    institution: '清华大学',
    url: 'https://www.tsinghua.edu.cn/en/info/1244/',
    required: false,
    maxDetailPages: 2,
    detailPathPrefixes: ['/en/info/1244/'],
    visualEvidenceRequired: false
  },
  {
    id: 'mit-media-lab',
    kind: 'page',
    adapter: 'listing',
    category: 'frontier',
    name: 'MIT Media Lab',
    institution: 'MIT',
    url: 'https://www.media.mit.edu/posts/',
    required: false,
    maxDetailPages: 3,
    detailPathPrefixes: ['/posts/'],
    visualEvidenceRequired: false
  }
  ])
});

export const DEFAULT_SOURCES = DEFAULT_SOURCE_CATALOG.sources;

export function normalizeSourceDefinitions(value) {
  const sources = Array.isArray(value) ? value : value?.sources;
  if (!Array.isArray(sources)) throw sourceError('sources_file_invalid');
  const seen = new Set();
  return sources.map((item) => {
    const source = {
      id: cleanText(item?.id, 200),
      kind: cleanText(item?.kind || item?.adapter, 50).toLowerCase(),
      adapter: cleanText(item?.adapter || item?.kind, 50).toLowerCase(),
      category: cleanText(item?.category, 50).toLowerCase(),
      name: cleanText(item?.name || item?.id, 300),
      institution: cleanText(item?.institution, 300) || null,
      url: cleanText(item?.url, 2000),
      authority: cleanText(item?.authority, 100) || undefined,
      required: item?.required === true || item?.requirement === 'required',
      maxDetailPages: Math.max(0, Math.min(10, Number(item?.maxDetailPages || 0))),
      detailPathPrefixes: [...new Set((Array.isArray(item?.detailPathPrefixes) ? item.detailPathPrefixes : []).map((prefix) => cleanText(prefix, 300)).filter((prefix) => prefix.startsWith('/')))].slice(0, 10),
      visualEvidenceRequired:
        item?.visualEvidenceRequired === true || ['product', 'ui'].includes(cleanText(item?.category, 50).toLowerCase())
    };
    if (
      !source.id ||
      seen.has(source.id) ||
      !['openalex', 'arxiv', 'rss', 'atom', 'page'].includes(source.kind) ||
      !['openalex', 'arxiv', 'rss', 'atom', 'page', 'listing'].includes(source.adapter) ||
      !['paper', 'product', 'ui', 'frontier'].includes(source.category) ||
      !source.url
    )
      throw sourceError('sources_file_invalid');
    seen.add(source.id);
    return source;
  });
}

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
        category: item.category,
        adapter: 'fixture',
        required: true,
        requirement: 'required',
        maxDetailPages: 0,
        visualEvidenceRequired: ['product', 'ui'].includes(item.category),
        status: 'fixture',
        candidateCount: 1,
        fetchedAt: item.fetchedAt,
        latencyMs: 0,
        error: null
      })),
      rejected: [],
      sourceCatalog: {
        schemaVersion: 'designsignal.sources.v2',
        fingerprint: sha256(stableStringify(items.map((item) => [item.source.id, item.category, 'fixture'])))
      }
    };
  }
  return collectLive(config, options);
}

export async function collectLive(
  config,
  { date, sources = DEFAULT_SOURCES, transport = requestBytes, cacheWriter = null, now = () => new Date(), signal = null } = {}
) {
  const definitions = normalizeSourceDefinitions(sources);
  const candidates = [];
  const sourceHealth = [];
  const rejected = [];
  for (const source of definitions) {
    const started = Date.now();
    const sourceCandidates = [];
    const sourceErrors = [];
    let fetchedAt = now().toISOString();
    try {
      const listingResponse = await fetchSourceResponse(source.url, source, config, { transport, signal });
      fetchedAt = now().toISOString();
      if (source.adapter === 'listing') {
        const detailUrls = parseListingLinks(listingResponse.bytes.toString('utf8'), {
          baseUrl: listingResponse.url || source.url,
          maximum: source.maxDetailPages,
          pathPrefixes: source.detailPathPrefixes
        });
        if (cacheWriter)
          await cacheWriter({
            source,
            bytes: listingResponse.bytes,
            fetchedAt,
            mimeType: contentType(listingResponse),
            url: listingResponse.url || source.url,
            parsed: []
          });
        const targets = detailUrls.length ? detailUrls : [source.url];
        for (const target of targets) {
          try {
            const response = target === source.url ? listingResponse : await fetchSourceResponse(target, source, config, { transport, signal });
            const detailSource = { ...source, url: response.url || target };
            const parsed = parseSource(detailSource, response.bytes, now().toISOString());
            sourceCandidates.push(...(await finalizeSourceItems(parsed, detailSource, source, response, config, { transport, cacheWriter, now, signal })));
          } catch (error) {
            sourceErrors.push(error);
          }
        }
      } else {
        const parsed = parseSource(source, listingResponse.bytes, fetchedAt);
        sourceCandidates.push(...(await finalizeSourceItems(parsed, source, source, listingResponse, config, { transport, cacheWriter, now, signal })));
      }
    } catch (error) {
      sourceErrors.push(error);
    }
    const visualWarnings = sourceCandidates
      .filter((item) => ['product', 'ui'].includes(item.category) && !item.image)
      .map((item) => item.visualRejection?.code || 'visual_evidence_unavailable');
    if (
      source.visualEvidenceRequired &&
      !sourceCandidates.some((item) => ['product', 'ui'].includes(item.category) && item.image?.verified === true)
    )
      sourceErrors.push(sourceError('visual_evidence_unavailable'));
    candidates.push(...sourceCandidates);
    const safeErrors = sourceErrors.map((error) => publicError(error, [config.apiKey]));
    for (const safe of safeErrors)
      rejected.push({ sourceId: source.id, candidateId: null, reason: 'source_unavailable', detail: safe.code });
    sourceHealth.push({
      sourceId: source.id,
      sourceName: source.name,
      category: source.category,
      adapter: source.adapter,
      required: source.required,
      requirement: source.required ? 'required' : 'optional',
      maxDetailPages: source.maxDetailPages,
      visualEvidenceRequired: source.visualEvidenceRequired,
      status: sourceErrors.length ? 'degraded' : sourceCandidates.length ? 'healthy' : 'empty',
      candidateCount: sourceCandidates.length,
      fetchedAt,
      latencyMs: Date.now() - started,
      error: safeErrors[0] || null,
      errorCodes: [...new Set(safeErrors.map((error) => error.code))],
      warningCodes: [...new Set(visualWarnings)]
    });
  }
  return {
    schemaVersion: 'designsignal.collection.v1',
    mode: 'live',
    date,
    collectedAt: now().toISOString(),
    candidates,
    sourceHealth,
    rejected,
    sourceCatalog: {
      schemaVersion: 'designsignal.sources.v2',
      fingerprint: sha256(
        stableStringify(
          definitions.map((source) => [
            source.id,
            source.url,
            source.required,
            source.category,
            source.adapter,
            source.maxDetailPages,
            source.detailPathPrefixes,
            source.visualEvidenceRequired
          ])
        )
      )
    }
  };
}

async function fetchSourceResponse(url, source, config, { transport, signal }) {
  const response = await transport(url, {
    allowedHosts: config.allowedHosts,
    timeoutMs: config.timeoutMs,
    maxBytes: config.maxBytes,
    retries: config.retries,
    headers: source.kind === 'openalex' ? { accept: 'application/json' } : undefined,
    signal
  });
  if (response.status < 200 || response.status >= 300) throw sourceError('source_http_error', { status: response.status });
  return response;
}

async function finalizeSourceItems(parsed, parseSourceDefinition, catalogSource, response, config, { transport, cacheWriter, now, signal }) {
  const fetchedAt = now().toISOString();
  const mimeType = contentType(response);
  await localizeVisualEvidence(parsed, catalogSource, config, { transport, cacheWriter, fetchedAt, signal });
  const cached = cacheWriter
    ? await cacheWriter({
        source: catalogSource,
        bytes: response.bytes,
        fetchedAt,
        mimeType: mimeType || null,
        url: response.url || parseSourceDefinition.url,
        parsed
      })
    : null;
  for (const item of parsed) {
    item.provenance = {
      adapter: catalogSource.adapter,
      sourceUrl: response.url || parseSourceDefinition.url,
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
  }
  return parsed;
}

function contentType(response) {
  return cleanText(response.headers?.['content-type'], 200).split(';')[0];
}

async function localizeVisualEvidence(items, source, config, { transport, cacheWriter, fetchedAt, signal = null }) {
  for (const item of items.filter((candidate) => ['product', 'ui'].includes(candidate.category) && candidate.image?.url)) {
    if (String(item.image.url).startsWith('/')) continue;
    try {
      const response = await transport(item.image.url, {
        allowedHosts: config.allowedHosts,
        timeoutMs: config.timeoutMs,
        maxBytes: Math.min(5_000_000, Math.max(500_000, config.maxBytes)),
        retries: config.retries,
        headers: { accept: 'image/png,image/jpeg,image/webp,image/gif' },
        signal
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
        cached: Boolean(cached),
        verified: true
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
