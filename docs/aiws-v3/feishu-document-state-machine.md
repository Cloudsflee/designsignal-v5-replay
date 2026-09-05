# Historical Feishu document state-machine material

Source label: validated V5 historical document delivery behavior, retained as read-only context.

The required semantics are:

1. Obtain a tenant token in memory; token acquisition has no document side effect.
2. Persist creating before document creation.
3. Persist the confirmed document ID and revision immediately after create.
4. Render one deterministic ordered block list and fingerprint it.
5. Write at most 50 root child blocks per request.
6. Before each write, persist cursor, chunk size, revision, and deterministic non-secret client token.
7. After confirmed success, persist the next cursor and new revision.
8. Resume only confirmed progress.
9. Timeout, interruption, `5xx`, malformed create success, malformed write success, or restart during create/write requires reconciliation and is never replayed automatically.
10. Manual reconciliation validates render/report identity, document ID, revision, and cursor.

V6 preserves these rules inside the unified `designsignal.outbox.v2` record and continues to recognize historical numeric schema-v1 document jobs without schema conversion.
