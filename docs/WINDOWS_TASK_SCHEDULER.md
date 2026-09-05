# Windows Task Scheduler

Use a dedicated local account with read access to the repository and write access only to the selected data directory.

1. Open Task Scheduler and create a task named `DesignSignal Daily`.
2. Trigger daily at `23:50` using the local `Asia/Shanghai` system timezone.
3. Program: the absolute path returned by `Get-Command node`.
4. Arguments: `bin\designsignal.mjs daily --data-dir <fresh-v6-data-directory>`.
5. Start in: the repository root.
6. Enable `Run task as soon as possible after a scheduled start is missed`.
7. Set `If the task is already running` to `Do not start a new instance`; the application date lock is the second guard.
8. Set `DESIGNSIGNAL_PUSH_CHANNELS=feishu` and `DESIGNSIGNAL_REQUIRED_CHANNEL=feishu`; put model and Feishu webhook values in the task account environment. Do not put secret values in arguments or exported task XML.

Validate with:

```powershell
node .\bin\designsignal.mjs doctor
node .\bin\designsignal.mjs daily --fixture --dry-run --date 2026-08-31
node .\bin\designsignal.mjs outbox --data-dir <fresh-v6-data-directory>
```

Review Task Scheduler history, `data\manifest.jsonl`, and `data\outbox` after the first live run.
If delivery is pending because a webhook secret was missing or unavailable, restore the task account environment variable and run:

```powershell
node .\bin\designsignal.mjs outbox --retry --data-dir <fresh-v6-data-directory>
node .\bin\designsignal.mjs verify --date YYYY-MM-DD --require-channel feishu --data-dir <fresh-v6-data-directory>
```
