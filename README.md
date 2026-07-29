# DesignSignal V5 Replay

DesignSignal creates an auditable daily set of public design and AI signals for Zhejiang University 337/902 study. It collects bounded public sources, selects a deterministic `2 papers / 1 product / 1 UI / 2 frontier` set, produces bilingual evidence analysis, maps it to the versioned 2027 syllabus, records working hypotheses with counterevidence, and generates one detailed core exercise.

The runtime is Node.js 24 ESM with zero production dependencies.

## Quick start

```bash
npm ci
npm test
node ./bin/designsignal.mjs doctor
node ./bin/designsignal.mjs collect --fixture --dry-run --date 2026-07-28
node ./bin/designsignal.mjs daily --fixture --dry-run --date 2026-07-28
node ./bin/designsignal.mjs serve --fixture --port 3379
```

Open <http://127.0.0.1:3379>. The offline fixture always contains exactly six records and does not use the network. A dry-run does not create the data directory or write cache, report, manifest, feedback, or outbox files.

## CLI

```text
collect   collect, validate, deduplicate, and select signals
daily     create the full report and, unless dry-run, persist and deliver it
serve     run the Dashboard and JSON API
doctor    verify runtime, syllabus, commands, source policy, and optional config
outbox    show durable delivery state; --retry processes due pending messages
schedule  wait for and run each 23:50 Asia/Shanghai boundary
```

Common options:

```text
--fixture                  use the deterministic offline fixture
--dry-run                  perform no writes
--date YYYY-MM-DD          Shanghai report date
--data-dir PATH            report/cache/outbox root
--sources PATH             custom JSON source catalog
--allowed-hosts a.example  comma-separated HTTPS host allowlist
--codex-config PATH        explicit Codex config read in memory
--model NAME               Responses-compatible model
--no-push                  skip outbox creation for this run
--retry                    with outbox, process due pending delivery records
```

## Live pipeline

Live collection supports OpenAlex JSON, arXiv Atom, RSS/Atom, and allowlisted page metadata. Network requests require HTTPS, an explicit host, public DNS answers, bounded redirects, timeout/retry limits, and a byte ceiling. OA PDF processing additionally requires OA metadata, PDF MIME, and a PDF signature. Login, CAPTCHA, paywall, cookie, and private-network bypasses are not supported.

A full live daily run holds one date lock from collection through delivery. Outputs are atomically written under `data/reports/YYYY-MM-DD/`:

```text
report.json
report.md
report.html
```

`data/manifest.jsonl` and `data/cache/index.jsonl` are append-only. Raw responses are content-addressed under `data/cache/blobs/`. A source shortage is visible in `selection.shortages`; the system never fabricates a replacement.

## Model configuration

The analysis path supports an OpenAI-compatible Responses API. Configure environment values from `.env.example`, or pass `--codex-config` to an explicit config file. API keys and webhook URLs stay in process memory and are redacted from errors. Invalid model JSON is retried and then replaced by a marked, non-authoritative deterministic fallback that preserves source evidence.

## Delivery

The durable outbox supports generic JSON webhooks, Feishu, and WeCom. Outbox files store payloads and an environment-variable name such as `FEISHU_WEBHOOK_URL`; they never store the endpoint value. Missing credentials leave a pending record while the report remains available. After restoring credentials, run `node ./bin/designsignal.mjs outbox --retry` to process due pending records without regenerating the daily report.

## HTTP API

| Route | Purpose |
|---|---|
| `GET /healthz` | runtime, latest date, and next schedule |
| `GET /api/reports/latest` | latest validated report |
| `GET /api/reports/:date` | dated report |
| `GET /api/syllabus` | versioned 337/902 evidence map |
| `GET /api/sources/health` | source health and degradation |
| `GET /api/outbox` | durable delivery state without secrets |
| `POST /api/feedback` | append next-day calibration feedback |

The Dashboard escapes external content and sets CSP, `nosniff`, frame denial, no-referrer, permissions restrictions, and same-origin opener policy.

## Docker

```bash
docker compose build
docker compose up -d
curl http://127.0.0.1:3385/healthz
```

Compose runs separate Dashboard and scheduler containers against one named data volume. The root filesystem is read-only, all Linux capabilities are dropped, config is mounted read-only, and the process runs as an unprivileged user.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Authority evidence](docs/EVIDENCE.md)
- [Source policy](docs/SOURCE_POLICY.md)
- [Security](docs/SECURITY.md)
- [Operations](docs/OPERATIONS.md)
- [Calibration](docs/CALIBRATION.md)
- [Windows Task Scheduler](docs/WINDOWS_TASK_SCHEDULER.md)
- [AIWS V2 replay record](docs/AIWS_REPLAY.md)

GitHub Actions runs at `50 15 * * *`, supports manual dispatch, serializes concurrent runs, and retains report artifacts for 30 days. Scheduled jobs on hosted runners can start after the requested minute; each report records its actual generation time.
