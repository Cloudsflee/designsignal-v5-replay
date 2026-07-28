# Security

## Network boundary

Collection requires HTTPS on port 443. Hosts must be explicitly allowlisted. DNS is resolved before the request, every answer is checked for loopback, private, carrier-grade NAT, link-local, multicast, and reserved ranges, and the approved address is pinned into the TLS request while preserving hostname verification. Every redirect repeats the same checks.

Responses are bounded by declared and streamed byte counts. Timeout and retry counts are bounded. OA PDF handling independently validates access metadata, MIME type, byte limit, and PDF signature.

## Secrets

Model and push credentials are read only from environment variables or an explicitly named Codex config. The application never serializes them. Outbox records store `secretEnv`, not endpoint values. Errors pass through explicit-value and token-pattern redaction.

## HTTP service

The server sets CSP, `nosniff`, frame denial, no-referrer, permissions restrictions, and same-origin opener policy. Dynamic content is HTML-escaped. Static files are served from an exact map, not a user-controlled filesystem path. Feedback bodies are size-limited and validated.

## Reporting

Report output is data, not executable HTML. Portable HTML escapes all external values. Source licensing and access state remain visible so downstream users can distinguish public metadata, OA content, and unknown rights.
