# Security

## Network boundary

Collection and delivery use HTTPS only. The host must be explicitly allowlisted, every DNS answer must be public, and the chosen address is pinned into the TLS lookup while hostname verification remains active. Redirects repeat validation.

Declared and streamed response sizes are bounded. Visuals and PDFs additionally require MIME and magic-byte validation.

GET/HEAD retries are narrow and bounded. Non-idempotent POST is never automatically replayed by the transport. Outbox-level retry occurs only after an explicit not-accepted result; ambiguous side effects stop for reconciliation.

## Secrets

Model keys, webhook URLs, Feishu app credentials, folder tokens, and tenant access tokens remain in process memory. Stored Outbox tasks contain only environment-variable names/configuration refs, payload fingerprint, and state. Safe API projections omit configuration refs and payloads.

Errors are reduced to bounded public codes before entering run receipts, readiness, or Outbox projections. Run receipts exclude host absolute paths and full model input.

## Integrity

- Source and visual bytes are content-addressed.
- Report integrity hashes stable JSON with its hash field set to null.
- Manifest file hashes are verified by the CLI and `/api/readiness`.
- Outbox reconciliation verifies task hash and report fingerprint.
- Feishu document reconciliation also verifies identity, revision, and cursor.

## HTTP service

The server sets CSP, `nosniff`, frame denial, no-referrer, permissions restrictions, and same-origin opener policy. External content is escaped. Static files and cached media are served from exact routes; no user-provided filesystem path is accepted.

`/api/outbox` returns only ID, channel, status, attempts, timestamps, error code, and a safe public document URL. `/api/readiness` and `/api/runs/latest` return no endpoint or payload.

## Container boundary

The production image runs as `node`, uses a read-only root filesystem through Compose, drops all Linux capabilities, denies privilege escalation, and writes only the fresh V6 data volume.
