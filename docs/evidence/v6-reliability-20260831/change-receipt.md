# DesignSignal V6 change receipt

```text
Target:
DesignSignal V5 baseline 5833494 on feature/v6-reliability-aiws-v3; implement V6 report, sources, Outbox, Readiness, Dashboard, verification, and delivery artifacts.
目标:
在独立 Fresh 状态中完成确定性 Fixture 闭环，并在凭据可用时完成 Live Gate；同步生成可复验的代码、补丁、验证记录和回滚脚本。
Non-target:
Frozen AIWS 5f2be38, V2/V5 production data, historical Evidence, generic-intelligence expansion, and production cutover.
非目标:
修改 AIWS、迁移旧运行状态、覆盖旧报告、放宽 SSRF/权限/脱敏边界。
Forbidden:
Mutating the AIWS baseline or production pointers/volumes; fabricating Live/model/webhook results; rewriting V5 v1 data.
禁止项:
旧新卷双写、非幂等自动重放、泄露 Secret/完整模型输入/绝对路径、无结果声明命令已运行。
Reuse:
V5 HTTPS allowlist, public DNS validation, pinned lookup, byte limits, retry allowlist, CLI/HTTP/Dashboard, Feishu document state-machine evidence, and the 40-test baseline.
复用项:
现有模块所有权、零生产依赖 Node 24 ESM、337/902 与 2/1/1/2 配额。
Delete/retire:
No historical capability deletion; new tasks use outbox.v2 while v1 remains readable and processable.
删除/退役:
无静默迁移、无历史报告改写。
Acceptance commands:
npm ci; npm run verify; two Docker builds with artifact comparison; Playwright+Axe at 390x844, 1024x768, and 1440x900; git diff --check; pnpm verify in frozen AIWS; fixture/performance/live/rollback commands recorded by verification.json.
验收命令:
同上，并记录每条命令的字面输出与退出状态。
Rollback artifact:
rollback.ps1 with modified-artifact.tgz, change.patch, and verification.json; dry-run first, then isolated actual apply with byte-exact code/data comparison.
回滚工件:
四件套均需重开、执行并验证。
```

## Confirmed baseline

- DesignSignal commit: `5833494e6fdc16201cc10ec8776578892e8d85b4`
- Branch: `feature/v6-reliability-aiws-v3`
- Frozen AIWS commit: `5f2be38845d36236637c7f22a1b4df5611a6175b`
- `npm ci`: exit `0`
- V5 baseline `npm test`: exit `0`, `40/40` passed
