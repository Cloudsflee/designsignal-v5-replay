import { cleanText, deterministicId } from './util.mjs';

export function parseOpenAlex(payload, { fetchedAt = new Date().toISOString(), category = 'paper' } = {}) {
  const value = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (!value || !Array.isArray(value.results)) throw parserError('openalex_payload_invalid');
  return value.results.map((work) => {
    const location = work.primary_location || work.best_oa_location || {};
    const source = location.source || {};
    const abstract = reconstructAbstract(work.abstract_inverted_index);
    const language = normalizeLanguage(work.language);
    return {
      id: cleanText(work.id, 500) || deterministicId('openalex', work.doi || work.title),
      canonicalId: canonicalIdentifier(work.doi || work.id || work.title),
      category,
      language,
      title: bilingualTitle(work.title, language),
      abstract: bilingualText(abstract, language),
      evidenceExcerpt: bilingualText(abstract.slice(0, 1200), language),
      methodHint: bilingualText('', language),
      source: {
        id: cleanText(source.id || 'openalex', 300),
        name: cleanText(source.display_name || 'OpenAlex', 300),
        url: cleanText(source.homepage_url || 'https://api.openalex.org/', 1000),
        kind: 'academic',
        institution: cleanText(work.authorships?.[0]?.institutions?.[0]?.display_name, 300) || null,
        authority: 'aggregated_metadata'
      },
      url: cleanText(location.landing_page_url || work.doi || work.id, 1000),
      publishedAt: isoDate(work.publication_date || work.created_date),
      fetchedAt,
      authors: (work.authorships || []).map((entry) => cleanText(entry.author?.display_name, 300)).filter(Boolean),
      image: null,
      access: {
        status: work.open_access?.is_oa ? 'open_access' : 'metadata_only',
        openAccess: Boolean(work.open_access?.is_oa),
        paywalled: !work.open_access?.is_oa,
        loginRequired: false,
        pdfUrl: cleanText(location.pdf_url || work.best_oa_location?.pdf_url, 1000) || null
      },
      license: {
        status: location.license ? 'declared' : 'unknown',
        name: cleanText(location.license, 200) || null,
        url: null
      },
      content: { mimeType: 'application/json', bytes: 0, sha256: null, cached: false },
      mappings: [],
      isFixture: false
    };
  });
}

export function parseArxivAtom(xml, { fetchedAt = new Date().toISOString() } = {}) {
  return xmlEntries(xml, 'entry').map((entry) => {
    const title = elementText(entry, 'title');
    const abstract = elementText(entry, 'summary');
    const id = elementText(entry, 'id');
    const links = elements(entry, 'link').map(attributes);
    const pdf = links.find((link) => link.title === 'pdf' || link.type === 'application/pdf');
    const landing = links.find((link) => link.rel === 'alternate')?.href || id;
    const language = guessLanguage(`${title} ${abstract}`);
    return {
      id: id || deterministicId('arxiv', title),
      canonicalId: canonicalIdentifier(id || title),
      category: 'paper',
      language,
      title: bilingualTitle(title, language),
      abstract: bilingualText(abstract, language),
      evidenceExcerpt: bilingualText(abstract.slice(0, 1200), language),
      methodHint: bilingualText('', language),
      source: {
        id: 'arxiv',
        name: 'arXiv',
        url: 'https://arxiv.org/',
        kind: 'academic',
        institution: null,
        authority: 'author_preprint'
      },
      url: cleanText(landing, 1000),
      publishedAt: isoDate(elementText(entry, 'published') || elementText(entry, 'updated')),
      fetchedAt,
      authors: xmlEntries(entry, 'author').map((author) => elementText(author, 'name')).filter(Boolean),
      image: null,
      access: {
        status: 'open_access',
        openAccess: true,
        paywalled: false,
        loginRequired: false,
        pdfUrl: cleanText(pdf?.href, 1000) || null
      },
      license: { status: 'repository_terms', name: null, url: 'https://arxiv.org/help/license' },
      content: { mimeType: 'application/atom+xml', bytes: Buffer.byteLength(entry), sha256: null, cached: false },
      mappings: [],
      isFixture: false
    };
  });
}

export function parseFeed(xml, { source, category = 'frontier', fetchedAt = new Date().toISOString() } = {}) {
  const itemTag = /<(?:[\w-]+:)?item\b/i.test(xml) ? 'item' : 'entry';
  return xmlEntries(xml, itemTag).map((entry) => {
    const title = elementText(entry, 'title');
    const description = stripMarkup(elementText(entry, itemTag === 'item' ? 'description' : 'summary') || elementText(entry, 'content'));
    const atomLink = elements(entry, 'link').map(attributes).find((link) => !link.rel || link.rel === 'alternate')?.href;
    const link = atomLink || elementText(entry, 'link');
    const identifier = elementText(entry, 'guid') || elementText(entry, 'id') || link || title;
    const language = guessLanguage(`${title} ${description}`);
    const media = elements(entry, 'content').map(attributes).find((attrs) => attrs.url && /^image\//.test(attrs.type || ''));
    return {
      id: cleanText(identifier, 1000) || deterministicId('feed', title),
      canonicalId: canonicalIdentifier(identifier),
      category,
      language,
      title: bilingualTitle(title, language),
      abstract: bilingualText(description, language),
      evidenceExcerpt: bilingualText(description.slice(0, 1200), language),
      methodHint: bilingualText('', language),
      source: {
        id: cleanText(source?.id || source?.name, 300),
        name: cleanText(source?.name, 300),
        url: cleanText(source?.url, 1000),
        kind: cleanText(source?.kind || 'feed', 100),
        institution: cleanText(source?.institution, 300) || null,
        authority: cleanText(source?.authority || 'publisher_feed', 100)
      },
      url: cleanText(link, 1000),
      publishedAt: isoDate(elementText(entry, 'pubDate') || elementText(entry, 'published') || elementText(entry, 'updated')),
      fetchedAt,
      authors: [elementText(entry, 'author') || elementText(entry, 'creator')].filter(Boolean),
      image: media?.url ? { url: media.url, altZh: title, altEn: title, license: 'source_page' } : null,
      access: { status: 'public', openAccess: true, paywalled: false, loginRequired: false },
      license: { status: 'unknown', name: null, url: null },
      content: { mimeType: 'application/xml', bytes: Buffer.byteLength(entry), sha256: null, cached: false },
      mappings: [],
      isFixture: false
    };
  });
}

export function parseAllowlistedPage(html, { source, category = 'product', fetchedAt = new Date().toISOString() } = {}) {
  const title = metaContent(html, 'og:title') || elementText(html, 'title');
  const description = metaContent(html, 'og:description') || metaContent(html, 'description');
  const url = metaContent(html, 'og:url') || source.url;
  const imageUrl = metaContent(html, 'og:image');
  const language = guessLanguage(`${title} ${description}`);
  if (!title || !url) throw parserError('page_metadata_incomplete');
  return [
    {
      id: cleanText(url, 1000),
      canonicalId: canonicalIdentifier(url),
      category,
      language,
      title: bilingualTitle(title, language),
      abstract: bilingualText(description, language),
      evidenceExcerpt: bilingualText(description, language),
      methodHint: bilingualText('', language),
      source: { ...source, authority: source.authority || 'publisher_page' },
      url,
      publishedAt: isoDate(metaContent(html, 'article:published_time')),
      fetchedAt,
      authors: [],
      image: imageUrl ? { url: imageUrl, altZh: title, altEn: title, license: 'source_page' } : null,
      access: { status: 'public', openAccess: true, paywalled: false, loginRequired: false },
      license: { status: 'unknown', name: null, url: null },
      content: { mimeType: 'text/html', bytes: Buffer.byteLength(html), sha256: null, cached: false },
      mappings: [],
      isFixture: false
    }
  ];
}

function reconstructAbstract(index) {
  if (!index || typeof index !== 'object') return '';
  const words = [];
  for (const [word, positions] of Object.entries(index))
    for (const position of Array.isArray(positions) ? positions : []) if (Number.isInteger(position)) words[position] = word;
  return cleanText(words.filter(Boolean).join(' '), 20_000);
}

function xmlEntries(xml, localName) {
  const safe = cleanText(xml, 5_000_000);
  const expression = new RegExp(`<(?:(?:[\\w-]+):)?${localName}\\b[^>]*>[\\s\\S]*?<\\/(?:(?:[\\w-]+):)?${localName}>`, 'gi');
  return safe.match(expression) || [];
}

function elements(xml, localName) {
  const expression = new RegExp(`<(?:(?:[\\w-]+):)?${localName}\\b[^>]*(?:\\/?>|>[\\s\\S]*?<\\/(?:(?:[\\w-]+):)?${localName}>)`, 'gi');
  return String(xml).match(expression) || [];
}

function elementText(xml, localName) {
  const paired = new RegExp(`<(?:(?:[\\w-]+):)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w-]+):)?${localName}>`, 'i').exec(xml)?.[1];
  return cleanText(decodeEntities(stripCdata(paired || '')), 20_000);
}

function attributes(tag) {
  const output = {};
  const expression = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of tag.matchAll(expression)) output[match[1].split(':').at(-1)] = decodeEntities(match[2] ?? match[3]);
  return output;
}

function metaContent(html, key) {
  for (const tag of String(html).match(/<meta\b[^>]*>/gi) || []) {
    const attrs = attributes(tag);
    if ([attrs.property, attrs.name].some((value) => String(value || '').toLowerCase() === key.toLowerCase()))
      return cleanText(attrs.content, 5000);
  }
  return '';
}

function stripMarkup(value) {
  return cleanText(decodeEntities(String(value).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' '), 20_000);
}

function stripCdata(value) {
  return String(value).replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '');
}

function decodeEntities(value) {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&#x([a-f\d]+);/gi, (_, number) => String.fromCodePoint(Number.parseInt(number, 16)));
}

function bilingualTitle(title, language) {
  const text = cleanText(title, 1000);
  return language === 'zh' ? { zh: text, en: '' } : { zh: '', en: text };
}

function bilingualText(value, language) {
  const text = cleanText(value, 20_000);
  return language === 'zh' ? { zh: text, en: '' } : { zh: '', en: text };
}

function canonicalIdentifier(value) {
  const text = cleanText(value, 2000).toLowerCase();
  try {
    const url = new URL(text);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|ref$|source$)/.test(key)) url.searchParams.delete(key);
    return url.href.replace(/\/$/, '');
  } catch {
    return text.replace(/\s+/g, ' ');
  }
}

function normalizeLanguage(value) {
  const language = String(value || '').toLowerCase();
  return language.startsWith('zh') ? 'zh' : 'en';
}

function guessLanguage(value) {
  const text = String(value || '');
  const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
  return cjk > Math.max(4, text.length * 0.08) ? 'zh' : 'en';
}

function isoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parserError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
