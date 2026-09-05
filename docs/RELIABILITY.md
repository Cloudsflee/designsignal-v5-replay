# Reliability contracts

## Report outcome

`designsignal.daily.v2.outcome` contains:

- `status`: `completed` or `completed_with_gaps`;
- fixed checks for quota, visuals, model, and required sources;
- structured gap codes with bounded public details;
- a SHA-256 fingerprint.

Stable blocking codes include:

| Code | Meaning |
|---|---|
| `quota_shortage` | selected category does not equal the fixed quota |
| `visual_evidence_incomplete` | product/UI local verified images are not exactly 2/2 |
| `authoritative_model_incomplete` | one or more analyses are fallback/non-authoritative |
| `required_source_degraded` | a required source is not healthy |

## Run receipt

`designsignal.run-receipt.v1` records the seven fixed stages, status, timestamps, measured duration, retry count, source summary, relative report reference, delivery counts, final status, and safe error code.

It never records a credential, webhook URL, model prompt, delivery payload, or host absolute path.

## Outbox v2

New tasks have one state field:

```text
pending -> dispatching -> sent | retry_wait | reconcile_required | failed
```

- `dispatching` is persisted before every non-idempotent remote side effect.
- Restart while `dispatching` becomes `reconcile_required`.
- Explicitly unaccepted responses (`408`, `425`, `429`) may enter `retry_wait`.
- Transport interruption, `5xx`, or malformed success after a side effect becomes `reconcile_required`.
- Other definite rejection becomes `failed`.
- POST transport retries are always zero.

Manual reconciliation requires `--confirm` and validates task hash, report fingerprint, revision, document identity, current cursor, and the only acceptable ambiguous chunk outcomes.

## Feishu document

Feishu document state is embedded in the same outbox.v2 record:

- fixed document ID after confirmed create;
- numeric revision;
- confirmed cursor and block count;
- maximum chunk size 50;
- deterministic non-secret client token derived from task/document/cursor/chunk/revision/fingerprint;
- confirmed chunks resume from their exact cursor;
- ambiguous create or write stops.

Tenant-token acquisition has no document side effect and may back off safely; access tokens stay in memory.

## Readiness

`designsignal.readiness.v1` exposes only six check groups and structured gaps:

```text
content, sources, model, delivery, integrity, slo
```

The server and CLI never return the Outbox payload or endpoint. The Dashboard uses this object; only `completed` is green.
