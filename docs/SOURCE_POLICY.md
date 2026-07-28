# Source Policy

## Allowed collection

- Public HTTPS metadata and pages from an explicit host allowlist.
- OpenAlex JSON, arXiv Atom, publisher RSS/Atom, and page metadata adapters.
- Public institutional and laboratory updates, product/design media, and public research blogs.
- An operator-provided public RSSHub endpoint for public WeChat or Zhihu feeds, only after its host is explicitly allowlisted.
- PDF download only when metadata marks the document open access and the response is a real `application/pdf` beginning with `%PDF-`.

## Prohibited collection

- Login, CAPTCHA, paywall, session-cookie, or access-control bypass.
- Browser cookie reuse, private tokens, private feeds, or scraped account sessions.
- HTTP, nonstandard ports, URL credentials, private/link-local/loopback DNS answers, or redirects outside the allowlist.
- Fabricated items used to satisfy a quota.

## Provenance

Every accepted live response records source URL, fetch time, DNS address, MIME type, byte count, SHA-256, adapter, attempts, authors, institution, access status, and license status. Product/UI visual URLs pass through the same network boundary, image MIME and magic-byte validation, and a 5 MB ceiling before the Dashboard receives a same-origin cache URL. Raw source and visual bytes use a content-addressed cache; metadata is append-only. Unknown license remains `unknown` and is not inferred.

## Default coverage

- Academic: OpenAlex, arXiv, Zhejiang University IDI, Tsinghua University, Tongji University, and international HCI/design sources.
- Product/UI: Core77, Dezeen, Designboom, Yanko Design, Awwwards, and Product Hunt.
- Frontier: OpenAI, Google DeepMind, Microsoft Research, and Hugging Face.

Source structure can change. A parse failure marks that source degraded and never triggers a synthetic replacement.
