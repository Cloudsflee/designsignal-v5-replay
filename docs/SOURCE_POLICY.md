# Source policy

## Catalog contract

New catalogs use `designsignal.sources.v2`. Every row declares:

- stable ID and category;
- source kind and adapter;
- `required` or optional status;
- maximum detail-page count (`0..10`);
- whether visual evidence is required.

The default inventory is fixed:

| Group | Sources | Required |
|---|---|---|
| Paper | OpenAlex, arXiv | OpenAlex |
| Product | Core77, Designboom, Yanko Design | Core77 |
| UI | Awwwards, Product Hunt, Dezeen | Awwwards |
| Frontier | OpenAI, DeepMind, Microsoft Research, Hugging Face, Tsinghua, MIT Media Lab | OpenAI |

The optional rows provide bounded redundancy. A layout/parser change degrades only that source. It never relaxes the network policy and never creates a synthetic replacement.

## Allowed collection

- Public HTTPS JSON, RSS, Atom, listing, detail pages, and visual images from an explicit host allowlist.
- OpenAlex and arXiv public metadata.
- Bounded same-host listing links up to the configured `maxDetailPages`.
- OA PDF only when metadata and license allow it, MIME is `application/pdf`, and bytes begin `%PDF-`.

## Rejected collection

- Login, CAPTCHA, paywall, cookie, private feed, session, or access-control bypass.
- HTTP, URL credentials, non-443 ports, private/link-local/loopback/reserved DNS, or unallowlisted redirects.
- Unbounded crawling or detail-page traversal.
- Fabricated quota fillers.

## Provenance and visuals

Each accepted response records adapter, source URL, fetched time, public pinned address, MIME, byte count, SHA-256, attempts, access, and license status.

Product and UI images pass the same HTTPS/DNS/allowlist boundary, image signature validation, and a 5 MB ceiling. A live visual counts toward completion only after bytes are verified, cached by SHA-256, and rewritten to `/api/media/<sha256>`.

Sanitized deterministic structures for JSON, RSS, Atom, listing, detail, and visual bytes live under `test/fixtures/source-structures/`.

## Retry policy

- GET/HEAD: retry bounded transport failures, `408`, `425`, `429`, and all `5xx`.
- Other `4xx`: return immediately.
- POST: no transport-layer automatic replay.

Every retry resolves public DNS again and rotates across the validated address set while pinning the selected address into TLS lookup.
