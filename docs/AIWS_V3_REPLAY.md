# AIWS V3 reliability replay

## Fixed boundary

- Product repository baseline: `5833494e6fdc16201cc10ec8776578892e8d85b4`.
- Product branch: `feature/v6-reliability-aiws-v3`.
- Frozen AIWS code: `5f2be38845d36236637c7f22a1b4df5611a6175b`.
- Project name: `DesignSignal V6 Reliability Replay`.
- Repository binding: existing repository at the fixed V5 baseline.
- State: fresh AIWS home, data directory, project, worktree, and volumes; no V2 state or production data migration.

The importable packet is under `docs/aiws-v3/`. `scripts/aiws-v3-packet.mjs` validates every referenced material and emits a deterministic fingerprint. Running the packet may create isolated AIWS runtime state, but it does not modify the frozen AIWS repository.

## Context materials

The packet labels and hashes:

- V5/V6 README and architecture;
- syllabus authority evidence;
- historical AIWS V2 replay record;
- V6 reliability and security constraints;
- validated historical Feishu document state-machine semantics;
- verification and rollback contract.

The Context Selection must retain the product scope, fixed quota, no-fabrication rule, fresh-volume boundary, non-idempotent delivery rules, and exact Live outcome. Conflicting generic-platform or state-migration guidance is excluded.

## Brief and workflow

The saved Brief requires deterministic Fixture first, then one real collection/model/Feishu webhook run. Critic review and Proposal apply must occur before workflow confirmation.

Six Workstreams are fixed:

1. Baseline and compatibility contracts.
2. Sources and network.
3. Outbox and delivery.
4. Outcome and run observation.
5. Dashboard and operations.
6. Verification and release.

Host Runner owns unit/syntax/fixture tests. Docker Runner owns container isolation, browser/Axe, reproducibility, release, and rollback verification. A failed stage/checkpoint is replayed by itself; a full runtime rerun does not replace failed verification evidence.

Quality uses coverage, accuracy, depth, consistency, and clarity. Evidence captures report, run receipt, safe Outbox projection, screenshots, tests, diff, Live receipt, and rollback comparison. Outcome is bound to the strict Live checks documented in `README.md`.

## Round 1 and Round 2

Round 1 always uses frozen AIWS `5f2be38`. Platform defects record operation, stage, error code, and manual workaround; no AIWS code is changed during the product execution.

Round 2 is created only if Round 1 has an AIWS-blocking defect. It uses an independent AIWS branch and entirely fresh runtime/data volumes while keeping the same DesignSignal baseline, Brief, workflow, Fixture, Live-date rule, and budget. If Round 1 has no platform blocker, Round 2 is `not_triggered`.

## Longitudinal observation

The fixed V2 baseline is:

```text
wall clock: 39h18m
tokens: 10.45M
executions: 24
superseded: 13
Runtime first-success rate: 1/8
```

The experiment records measured wall/stage times, token count or `null`, execution/attempt/supersede counts, human approvals/input/workarounds, Context convergence, failures by owner, checkpoint replay/full rerun counts, and Gate/Docker/Live/Delivery durations. These observations do not promote or block an otherwise valid DesignSignal V6 release.

## Commands

```bash
npm run verify:aiws-packet
npm run verify
npm run test:performance
npm run test:browser
npm run test:docker-repro
```

The frozen AIWS repository is independently checked with `pnpm verify`; its literal output and exit status belong in the final verification record.
