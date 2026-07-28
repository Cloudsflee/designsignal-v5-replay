# Operations

## Local run

```bash
npm ci
npm test
node ./bin/designsignal.mjs doctor
node ./bin/designsignal.mjs daily --fixture --dry-run --date 2026-07-28
node ./bin/designsignal.mjs serve --fixture --port 3379
```

For live collection, review `.env.example`, copy only the required values into the process environment, and omit `--fixture`. A missing model uses the marked deterministic fallback. A missing webhook keeps the generated report and leaves a `push_secret_missing` message pending.

## Scheduler

`node ./bin/designsignal.mjs schedule` calculates the next `23:50 Asia/Shanghai` boundary independent of the host timezone. The daily date lock covers collection, analysis, persistence, and delivery. A lock older than 12 hours is quarantined as stale before recovery.

GitHub Actions uses `50 15 * * *`, the UTC equivalent of 23:50 Shanghai. Hosted runners may start later than the cron minute; the report records its real generation time and Shanghai report date. Concurrency is serialized and artifacts remain for 30 days.

## Docker

```bash
docker compose build
docker compose up -d
docker compose ps
curl http://127.0.0.1:3385/healthz
```

The image runs as the unprivileged `node` user. Compose drops all capabilities, uses a read-only root filesystem and read-only config mount, and stores reports/cache/outbox in `designsignal-v5-data`.

## Recovery

1. Check `/healthz`, `data/manifest.jsonl`, and outbox status.
2. Do not edit an existing dated report in place. Preserve it and run a new date or restore from its artifact.
3. A `.tmp` file is never authoritative. Only manifest-referenced final files are deliverables.
4. For a pending outbox record, restore the referenced environment secret and rerun `daily` on a new date or call the outbox processor from an operator script.
5. If a source is degraded, verify TLS, DNS, allowlist, MIME, and parser shape. Do not loosen private-network checks.

## Health and retention

- `/healthz` reports version, mode, uptime, latest report date, and next scheduled UTC instant.
- `/api/sources/health` reports per-source candidate count, latency, and degraded status.
- Keep report artifacts according to study needs. Cache blobs can be garbage-collected only after no retained manifest or citation references their SHA-256.
