# Architecture

DesignSignal is a Node.js 24 ESM application with no production dependencies. The same validated daily report object drives JSON, Markdown, portable HTML, the Dashboard, and delivery payloads.

## Data flow

1. `sources.mjs` fetches OpenAlex JSON, arXiv Atom, RSS/Atom, or allowlisted page metadata.
2. `security.mjs` validates HTTPS, host allowlists, DNS answers, redirect targets, timeout, retry, and byte limits before content is accepted.
3. `cache.mjs` stores live responses as content-addressed blobs and appends provenance metadata.
4. `select.mjs` applies 2/1/1/2 quotas, source and language diversity, and a 60-day canonical-ID window. A shortage remains a shortage.
5. `analyze.mjs` uses a Responses-compatible model when configured, validates its structured output twice, and otherwise uses an explicitly non-authoritative deterministic fallback.
6. `report.mjs` builds evidence-balanced hypotheses and one 150-minute core exercise.
7. `storage.mjs` holds a date lock for the full live run and atomically writes JSON, Markdown, and HTML before appending the manifest.
8. `outbox.mjs` persists message bodies and environment-variable references, then resolves webhook endpoints only in memory.

## Invariants

- A dry-run does not create the data directory.
- A complete report contains exactly two papers, one product, one UI case, and two frontier signals.
- Product and UI records require visual evidence.
- Every analysis citation contains fetch time and content SHA-256.
- Hypotheses always include evidence, counterevidence, confidence below 1, and `working_hypothesis` status.
- Report writers for the same Shanghai date cannot overlap.
- No credential value enters a report, cache index, outbox file, log, or API response.
