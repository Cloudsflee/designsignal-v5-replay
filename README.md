# DesignSignal V6 Reliability Replay

DesignSignal remains focused on Zhejiang University 337/902. It collects a bounded public-source set, selects exactly `2 papers / 1 product / 1 UI / 2 frontier` records, analyzes them against the fixed 2027 syllabus, persists an auditable report, and closes delivery through a durable Outbox.

V6 adds a reliability loop without changing the product into a general intelligence platform:

- new reports use `designsignal.daily.v2`; immutable V5 `designsignal.daily.v1` reports remain readable and are never rewritten;
- content outcome is `completed` or `completed_with_gaps` with structured gap codes;
- every persisted run writes `designsignal.run-receipt.v1` for `collect -> select -> analyze -> synthesize -> persist -> deliver -> verify`;
- source catalogs use `designsignal.sources.v2` with required/optional classification, adapter, detail-page bound, and visual-evidence policy;
- new deliveries use `designsignal.outbox.v2`; webhook v1 and Feishu document v1 records remain readable and processable under their original schema;
- `/api/readiness`, `/api/runs/latest`, and `verify --require-channel` expose safe operational state without payloads, endpoints, credentials, full model input, or host paths.

The runtime is Node.js 24 ESM with zero production dependencies.

## Quick start

```bash
npm ci
npm run verify
npm run test:performance
npm run test:browser
node ./bin/designsignal.mjs daily --fixture --dry-run --date 2026-08-31
node ./bin/designsignal.mjs serve --fixture --port 3379
```

Open `http://127.0.0.1:3379`. The offline fixture always contains exactly six records, performs no network/model/delivery side effects, and writes nothing in dry-run mode. Because its local deterministic analysis is deliberately non-authoritative, its content outcome is `completed_with_gaps` rather than green readiness.

## Completion semantics

`designsignal.daily.v2.outcome.status` is:

- `completed`: exact quota, two verified same-origin visual records, authoritative model result for every selected item, and no degraded required source;
- `completed_with_gaps`: a valid audit report exists but one or more checks are incomplete;
- no valid report or a persistence failure: the run receipt is `failed`.

Overall readiness additionally requires:

- the required delivery channel has exactly one confirmed `sent` task;
- no `pending`, `retry_wait`, `dispatching`, `reconcile_required`, or `failed` task remains;
- report and persisted file hashes match;
- the run receipt is complete and the total duration is no more than 20 minutes.

The Dashboard is green only for overall `completed` readiness. A `5/6` report, deterministic/model fallback, degraded required source, pending delivery, reconciliation, integrity mismatch, or missing SLO receipt stays amber.

## CLI

```text
collect   collect, validate, deduplicate, and select signals
daily     create, persist, deliver, and verify one daily report
serve     run the Dashboard and JSON API
doctor    verify runtime, source catalog, deadline, commands, and storage
outbox    show safe durable delivery state; --retry processes due tasks
verify    verify report, files, run receipt, SLO, and required channel
schedule  wait for and run each 23:50 Asia/Shanghai boundary
```

Common options:

```text
--fixture                  deterministic offline fixture
--dry-run                  no report/cache/manifest/outbox/run-receipt writes
--date YYYY-MM-DD          Shanghai report date
--data-dir PATH            fresh report/cache/outbox/run root
--sources PATH             designsignal.sources.v2 JSON catalog
--allowed-hosts a.example  comma-separated HTTPS allowlist
--codex-config PATH        explicit Codex config read in memory only
--model NAME               Responses-compatible model
--require-channel NAME     delivery channel required by readiness
--no-push                  skip Outbox creation; readiness remains incomplete
--retry                    process due Outbox tasks
```

Verification and reconciliation:

```bash
node ./bin/designsignal.mjs verify --date 2026-08-31 --require-channel feishu
node ./bin/designsignal.mjs outbox --retry --data-dir ./data-v6
node ./bin/designsignal.mjs outbox reconcile --id MSG_ID --observed absent --confirm --data-dir ./data-v6
node ./bin/designsignal.mjs outbox reconcile --id MSG_ID --observed document --document-id DOC_ID --revision 8 --confirmed-blocks 50 --confirm --data-dir ./data-v6
```

Reconciliation verifies task hash, report fingerprint, document identity, revision, and cursor before changing state.

## Source reliability

The default catalog has 14 sources across four fixed groups:

- Paper: OpenAlex, arXiv.
- Product: Core77, Designboom, Yanko Design.
- UI: Awwwards, Product Hunt, Dezeen.
- Frontier: OpenAI, Google DeepMind, Microsoft Research, Hugging Face, Tsinghua, MIT Media Lab.

OpenAlex, Core77, Awwwards, and OpenAI are required. Other sources are bounded redundancy. A parser/page change degrades only that source and never creates a synthetic candidate.

All live requests require HTTPS, an explicit allowlist, public DNS answers, pinned lookup, bounded redirects, byte ceilings, and timeouts. GET/HEAD retry only transport failures, `408`, `425`, `429`, and any `5xx`. Non-idempotent POST requests receive no transport-layer automatic replay.

## Outbox reliability

The channel registry is fixed to `generic`, `feishu`, `wecom`, and `feishu-document`.

New tasks use:

```text
pending -> dispatching -> sent | retry_wait | reconcile_required | failed
```

The task is atomically persisted as `dispatching` before a remote side effect. A restart that finds an unconfirmed dispatch moves it to `reconcile_required`. Explicitly unaccepted responses such as `429` may back off. Timeout, connection interruption, `5xx`, or malformed success after a non-idempotent side effect require reconciliation and are not replayed automatically.

Feishu document writes preserve one document ID, revision, cursor, chunk size of at most 50, and deterministic non-secret client token. Confirmed chunks resume from the persisted cursor; ambiguous create/write results stop.

Live verification enables only the Feishu webhook. The other three channels are fully exercised with deterministic fixture transports.

## HTTP API

| Route | Purpose |
|---|---|
| `GET /healthz` | runtime, latest date, schedule, storage, and content readiness |
| `GET /api/readiness` | content/source/model/delivery/integrity/SLO checks |
| `GET /api/runs/latest` | latest safe run receipt |
| `GET /api/reports/latest` | latest validated report |
| `GET /api/reports/:date` | dated report, including v1 compatibility |
| `GET /api/syllabus` | versioned 337/902 evidence map |
| `GET /api/sources/health` | source health and degradation |
| `GET /api/outbox` | IDs, channel, state, attempts, times, error code, and public document link only |
| `POST /api/feedback` | append next-day calibration feedback |

## Live gate

Before a Live run, provide an authoritative Responses-compatible model credential and `FEISHU_WEBHOOK_URL` through the process environment/Vault. Use a fresh V6 data directory or volume.

```bash
export DESIGNSIGNAL_DATA_DIR=./data-v6-live
export DESIGNSIGNAL_PUSH_CHANNELS=feishu
export DESIGNSIGNAL_REQUIRED_CHANNEL=feishu
node ./bin/designsignal.mjs daily --date YYYY-MM-DD
node ./bin/designsignal.mjs verify --date YYYY-MM-DD --require-channel feishu
```

Live passes only with exact `2/1/1/2`, two verified local visuals, no degraded required source, authoritative model output, Feishu `sent=1`, no unfinished/failed Outbox task, valid hashes, and total duration no more than 20 minutes. Missing credentials leave the gate incomplete; no success is inferred.

## Docker and fresh volumes

```bash
docker compose build
docker compose up -d
curl http://127.0.0.1:3385/healthz
npm run test:docker-repro
npm run test:docker-runtime
```

Compose uses the new `designsignal-v6-data` volume. V5 data is not mounted, migrated, or mutated. The root filesystem is read-only, all Linux capabilities are dropped, configuration is read-only, and the process runs as the unprivileged `node` user.

## Verification inventory

```bash
npm ci
npm run verify
npm run test:performance
npm run test:browser
npm run test:docker-repro
npm run test:docker-runtime
git diff --check
```

The browser gate covers `390x844`, `1024x768`, and `1440x900` with Playwright and Axe. See [Verification](docs/VERIFICATION.md) for release and rollback commands.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Reliability contracts](docs/RELIABILITY.md)
- [Verification and rollback](docs/VERIFICATION.md)
- [AIWS V3 replay design](docs/AIWS_V3_REPLAY.md)
- [Authority evidence](docs/EVIDENCE.md)
- [Source policy](docs/SOURCE_POLICY.md)
- [Security](docs/SECURITY.md)
- [Operations](docs/OPERATIONS.md)
- [Calibration](docs/CALIBRATION.md)
- [Windows Task Scheduler](docs/WINDOWS_TASK_SCHEDULER.md)
- [Historical AIWS V2 replay](docs/AIWS_REPLAY.md)
