# Operations

## Deterministic fixture

```bash
npm ci
npm run verify
npm run test:performance
npm run test:browser
node ./bin/designsignal.mjs daily --fixture --dry-run --date 2026-08-31
```

Fixture mode has zero network/model/message side effects. Its deterministic analysis is non-authoritative, so an amber outcome is expected.

## Fresh live run

Use a new directory or the `designsignal-v6-data` volume. Do not point V6 at a V5 production volume.

```bash
export DESIGNSIGNAL_DATA_DIR=./data-v6-live
export DESIGNSIGNAL_PUSH_CHANNELS=feishu
export DESIGNSIGNAL_REQUIRED_CHANNEL=feishu
export DESIGNSIGNAL_MODEL=MODEL
export DESIGNSIGNAL_OPENAI_API_KEY=VALUE_FROM_VAULT
export FEISHU_WEBHOOK_URL=VALUE_FROM_VAULT
DATE=YYYY-MM-DD
node ./bin/designsignal.mjs daily --date "$DATE"
node ./bin/designsignal.mjs verify --date "$DATE" --require-channel feishu
```

Live is successful only when the verify command exits `0`. Missing model or webhook configuration leaves a structured gap.

## Outbox

```bash
node ./bin/designsignal.mjs outbox --data-dir ./data-v6-live
node ./bin/designsignal.mjs outbox --retry --data-dir ./data-v6-live
```

For an ambiguous task, inspect the remote system and then record exactly one observation:

```bash
node ./bin/designsignal.mjs outbox reconcile --id MSG_ID --observed absent --confirm --data-dir ./data-v6-live
node ./bin/designsignal.mjs outbox reconcile --id MSG_ID --observed document --document-id DOC_ID --revision N --confirmed-blocks N --confirm --data-dir ./data-v6-live
```

Do not edit Outbox JSON manually. A mismatched hash, fingerprint, revision, or cursor is rejected.

## Scheduler

`schedule` calculates the next 23:50 Asia/Shanghai boundary independent of host timezone. The date lock covers all seven stages. A lock older than 12 hours is quarantined before a new holder is admitted.

## Health and diagnostics

```bash
curl http://127.0.0.1:3379/healthz
curl http://127.0.0.1:3379/api/readiness
curl http://127.0.0.1:3379/api/runs/latest
curl http://127.0.0.1:3379/api/outbox
```

Use source error codes to repair parsers or allowlists. Do not weaken SSRF rules. Use the run receipt to replay only the failed workstream/stage in AIWS; do not rerun a complete runtime merely to hide a verify failure.

## Docker

```bash
docker compose build
docker compose up -d
docker compose ps
curl http://127.0.0.1:3385/healthz
npm run test:docker-repro
```

The reproducibility gate builds twice from the pinned base and compares the byte manifest under `/app` while verifying the runtime user is `node`.

## Backup and rollback

Before cutover, archive V5 code/image digest, its data manifest, Outbox, and deployment pointer read-only. V6 uses a separate volume.

Rollback:

1. stop the V6 scheduler/dashboard;
2. switch the code/image pointer to the archived V5 commit/image;
3. mount the original V5 data snapshot, not V6 data;
4. run the V5 health/read-only checks;
5. retain V6 data and receipts for audit.

The release artifact `rollback.ps1` changes code only. Its dry-run and isolated actual apply prove the patch reverses to `5833494` and leaves report/manifest/Outbox/pointer test bytes unchanged.
