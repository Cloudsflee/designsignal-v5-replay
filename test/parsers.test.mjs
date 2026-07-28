import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAllowlistedPage, parseArxivAtom, parseFeed, parseOpenAlex } from '../src/parsers.mjs';

test('OpenAlex parser reconstructs abstract and OA provenance fields', () => {
  const [item] = parseOpenAlex({
    results: [
      {
        id: 'https://openalex.org/W1',
        doi: 'https://doi.org/10.1/example',
        title: 'Design Evidence',
        language: 'en',
        publication_date: '2026-07-20',
        abstract_inverted_index: { Evidence: [1], Design: [0] },
        open_access: { is_oa: true },
        primary_location: {
          landing_page_url: 'https://example.org/work',
          pdf_url: 'https://example.org/work.pdf',
          license: 'cc-by',
          source: { id: 'S1', display_name: 'Journal', homepage_url: 'https://example.org/' }
        },
        authorships: [{ author: { display_name: 'A. Author' }, institutions: [{ display_name: 'Lab' }] }]
      }
    ]
  });
  assert.equal(item.abstract.en, 'Design Evidence');
  assert.equal(item.access.openAccess, true);
  assert.equal(item.access.pdfUrl, 'https://example.org/work.pdf');
  assert.deepEqual(item.authors, ['A. Author']);
});

test('arXiv Atom parser is namespace tolerant and keeps PDF access metadata', () => {
  const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>https://arxiv.org/abs/2607.1</id><updated>2026-07-20T00:00:00Z</updated><published>2026-07-19T00:00:00Z</published><title>Reliable Agents</title><summary>Trace replay evidence.</summary><author><name>Researcher</name></author><link href="https://arxiv.org/abs/2607.1" rel="alternate"/><link href="https://arxiv.org/pdf/2607.1" title="pdf" type="application/pdf"/></entry></feed>`;
  const [item] = parseArxivAtom(xml);
  assert.equal(item.title.en, 'Reliable Agents');
  assert.equal(item.access.openAccess, true);
  assert.equal(item.access.pdfUrl, 'https://arxiv.org/pdf/2607.1');
  assert.deepEqual(item.authors, ['Researcher']);
});

test('RSS and Atom feed parser decodes entities and strips untrusted markup', () => {
  const rss = `<rss><channel><item><guid>one</guid><title>Design &amp; AI</title><link>https://example.org/one</link><description><![CDATA[<b>Evidence</b> only]]></description><pubDate>Mon, 20 Jul 2026 00:00:00 GMT</pubDate></item></channel></rss>`;
  const [item] = parseFeed(rss, { source: { id: 'feed', name: 'Feed', url: 'https://example.org/feed' } });
  assert.equal(item.title.en, 'Design & AI');
  assert.equal(item.abstract.en, 'Evidence only');
  assert.equal(item.url, 'https://example.org/one');
});

test('allowlisted page adapter reads only explicit metadata', () => {
  const html = `<html><head><title>Fallback title</title><meta property="og:title" content="Public product"><meta property="og:description" content="Repair evidence"><meta property="og:url" content="https://example.org/product"><meta property="og:image" content="https://example.org/product.png"></head><body><script>alert(1)</script></body></html>`;
  const [item] = parseAllowlistedPage(html, {
    source: { id: 'page', name: 'Page', url: 'https://example.org/', kind: 'product_media' },
    category: 'product'
  });
  assert.equal(item.title.en, 'Public product');
  assert.equal(item.image.url, 'https://example.org/product.png');
  assert.equal(item.abstract.en.includes('alert'), false);
});
