# Architecture

DesignSignal V6 is a Node.js 24 ESM application with zero production dependencies. It remains a Zhejiang University 337/902 study product. V6 changes reliability contracts, not product scope.

## Ownership

| Owner | Responsibility |
|---|---|
| `sources.mjs` | `designsignal.sources.v2`, collection, bounded listing/detail traversal, source health |
| `security.mjs` | HTTPS/allowlist/public-DNS/pinned lookup, bytes, redirect, deadline signal, retry policy |
| `select.mjs` | deterministic `2/1/1/2`, diversity, 60-day dedupe, shortage audit |
| `analyze.mjs` | Responses-compatible analysis, application-level validation retry, non-authoritative fallback |
| `report.mjs` + `outcome.mjs` | `designsignal.daily.v2`, content outcome, Markdown/HTML derivation |
| `storage.mjs` | date lock, atomic report publication, immutable dated directory, append-only manifest |
| `outbox.mjs` | one four-channel registry, outbox.v2 state machine, v1 compatibility, reconciliation |
| `run-receipt.mjs` | seven-stage `designsignal.run-receipt.v1`, safe error codes, duration/retry/source summary |
| `readiness.mjs` | content/source/model/delivery/integrity/SLO aggregation and persisted verification |
| `server.mjs` + `dashboard.mjs` | safe API projections and the existing V5 visual direction with reliability status |

No second report store, Outbox ledger, run ledger, or delivery state machine is introduced.

## Daily transaction boundary

One date lock covers the whole non-dry run:

```text
collect -> select -> analyze -> synthesize -> persist -> deliver -> verify
```

1. `collect` reads v2 source definitions and live history, fetches bounded public content, and records source degradation.
2. `select` applies exact quota and dedupe without quota fabrication.
3. `analyze` calls the configured model only when model and credential are present; each model POST is an explicit application attempt, not a transport replay.
4. `synthesize` writes a valid v2 report or fails before publication.
5. `persist` atomically publishes JSON/Markdown/HTML, latest pointer, and manifest.
6. `deliver` creates outbox.v2 tasks, atomically marks each dispatch, and records only confirmed side effects.
7. `verify` checks report integrity and manifest presence; final readiness additionally evaluates Outbox, SLO, and persisted file hashes.

A live `AbortSignal` enforces the hard 20-minute ceiling. A timeout becomes `run_deadline_exceeded` in the failed run receipt.

## Content outcome versus operational readiness

The report owns content-level outcome:

- exact quota;
- two verified same-origin visual records;
- authoritative completed model record for each item;
- all required sources healthy.

Operational readiness adds:

- exactly one confirmed required channel;
- no unfinished, reconciliation, or failed Outbox task;
- report and file integrity;
- a non-failed run receipt within the 20-minute SLO.

The report is immutable after publication. Delivery does not rewrite the report; APIs and the Dashboard derive current readiness from report + run receipt + Outbox.

## Version compatibility

- New reports: `designsignal.daily.v2`.
- Historical reports: `designsignal.daily.v1`, read-only and never rewritten.
- New deliveries: `designsignal.outbox.v2`.
- Historical webhook records: `designsignal.outbox.v1`, processed without schema conversion.
- Historical Feishu document records: numeric schema `1`, processed/reconciled in their original shape.

## Data layout

```text
data-v6/
  reports/YYYY-MM-DD/{report.json,report.md,report.html}
  reports/latest.json
  runs/YYYY-MM-DD-run_*.json
  runs/latest.json
  outbox/*.json
  cache/blobs/<prefix>/<sha256>
  cache/index.jsonl
  manifest.jsonl
  feedback/YYYY-MM-DD.jsonl
```

Run receipts and public API projections contain relative report refs only. They exclude credentials, endpoint values, full model input, delivery payloads, and host absolute paths.

## Fresh-volume and rollback boundary

V6 uses `designsignal-v6-data`. V5 never reads V6 reports or Outbox state. Rollback switches code/image and the deployment pointer back to the archived V5 snapshot; it does not downgrade-write V6 data.
