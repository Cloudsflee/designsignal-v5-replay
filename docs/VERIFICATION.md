# Verification and rollback

## Product gates

```bash
npm ci
npm run verify:aiws-packet
npm run verify
npm run test:performance
npm run test:browser
npm run test:docker-repro
npm run test:docker-runtime
git diff --check
```

`npm run verify` performs syntax, all tests, doctor, collect Fixture dry-run, and daily Fixture dry-run. Separate gates preserve their structured receipts:

- performance: Fixture 20-run p95 <= 1500 ms and 100 core GET requests p95 <= 200 ms;
- browser: `390x844`, `1024x768`, `1440x900`, zero Axe violations, horizontal overflow, card overlap, broken image, console error, page error, and HTTP error;
- Docker: two no-cache builds from the pinned base, equal `/app` byte manifests, runtime user `node`.
- Docker runtime: actual non-root process, read-only root, `cap-drop=ALL`, no-new-privileges, writable isolated data volume, health response, and scheduler/shared-volume Compose contract.

## Live gate

Use a fresh data directory and only the Feishu webhook channel:

```bash
node ./bin/designsignal.mjs daily --date YYYY-MM-DD
node ./bin/designsignal.mjs verify --date YYYY-MM-DD --require-channel feishu
```

The second command exits `0` only for exact `2/1/1/2`, visual `2/2`, authoritative model `6/6`, all required sources healthy, Feishu `sent=1`, no unfinished/failed Outbox state, valid report/file hashes, and run duration <= 20 minutes.

Credential absence is recorded as incomplete Live input. Fixture evidence is not relabeled as Live evidence.

## Four release artifacts

The release generator creates outside the tracked product tree:

1. `modified-artifact.tgz` - complete changed product artifact without `.git`, `node_modules`, data, or temporary files.
2. `change.patch` - binary-capable patch from `5833494` to the V6 worktree.
3. `verification.json` - exact commands, stdout, stderr, exit status, timings, hashes, and remaining conditions.
4. `rollback.ps1` - validates the target, supports `-DryRun`, and reverse-applies `change.patch`.

## Rollback verification

1. Create an isolated clone at `5833494`.
2. Apply `change.patch` and verify the modified behavior.
3. Seed isolated report, manifest, Outbox, and deployment-pointer bytes.
4. Run `rollback.ps1 -DryRun`.
5. Run `rollback.ps1` on the isolated modified clone.
6. Verify the Git-visible code is byte-identical to `5833494`.
7. Verify report, manifest, Outbox, and pointer bytes are unchanged.

Rollback never writes a V5 schema into V6 data. Deployment rollback selects the archived V5 code/image and V5 data snapshot.
