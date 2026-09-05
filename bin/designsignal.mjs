#!/usr/bin/env node

import { doctor, runCollect, runDaily } from '../src/app.mjs';
import { parseCli, resolveConfig } from '../src/config.mjs';
import { outboxStatus, processOutbox, reconcileOutbox } from '../src/outbox.mjs';
import { verifyPersistedRun } from '../src/readiness.mjs';
import { runSchedule } from '../src/scheduler.mjs';
import { startServer } from '../src/server.mjs';
import { parseDateOnly, publicError, shanghaiDate, stableStringify } from '../src/util.mjs';

const parsed = parseCli();
const config = resolveConfig(parsed.options);

try {
  if (parsed.command === 'collect') {
    const result = await runCollect(config);
    print({
      schemaVersion: 'designsignal.collect-result.v1',
      date: result.date,
      mode: result.collection.mode,
      dryRun: config.dryRun,
      candidateCount: result.collection.candidates.length,
      selectedCount: result.selection.selected.length,
      counts: result.selection.counts,
      complete: result.selection.complete,
      shortages: result.selection.shortages,
      selected: result.selection.selected.map((item) => ({ id: item.id, category: item.category, source: item.source.name })),
      writeCount: 0
    });
  } else if (parsed.command === 'daily') {
    const result = await runDaily(config);
    if (config.json || config.dryRun) print(result.report);
    else
      print({
        reportId: result.report.id,
        date: result.report.date,
        selectedCount: result.report.items.length,
        outcome: result.report.outcome.status,
        readiness: result.readiness?.status || result.report.outcome.status,
        reportRef: result.receipt?.report?.ref || null,
        runReceiptId: result.receipt?.id || null,
        outboxCount: result.outbox.length
      });
  } else if (parsed.command === 'doctor') {
    const result = await doctor(config);
    print(result);
    if (!result.ok) process.exitCode = 1;
  } else if (parsed.command === 'outbox') {
    const reconcile = parsed.positional[0] === 'reconcile';
    if (reconcile) {
      const result = await reconcileOutbox(config.dataDir, {
        id: parsed.options.id,
        observed: parsed.options.observed,
        documentId: parsed.options.documentId,
        revision: parsed.options.revision,
        confirmedBlocks: parsed.options.confirmedBlocks,
        confirm: Boolean(parsed.options.confirm)
      });
      print({ schemaVersion: 'designsignal.outbox-reconcile-result.v1', reconciled: result });
      process.exitCode = result.status === 'failed' ? 1 : 0;
    } else {
      const retry = Boolean(parsed.options.retry || parsed.options.process);
      const processed = retry ? await processOutbox(config.dataDir) : [];
      const status = await outboxStatus(config.dataDir);
      print({
        ...status,
        retry,
        processedCount: processed.length
      });
    }
  } else if (parsed.command === 'verify') {
    const date = parseDateOnly(config.date);
    const result = await verifyPersistedRun(config.dataDir, {
      date,
      requireChannel: parsed.options.requireChannel || config.requiredChannel,
      deadlineMs: config.liveDeadlineMs
    });
    print(result);
    if (result.status !== 'completed') process.exitCode = 1;
  } else if (parsed.command === 'serve') {
    const fallback = config.mode === 'fixture' ? (await runDaily({ ...config, dryRun: true, noPush: true })).report : null;
    const service = await startServer(config, { fallbackReport: fallback });
    process.stdout.write(`DesignSignal listening on ${service.url}\n`);
  } else if (parsed.command === 'schedule') {
    await runSchedule(
      async (scheduled) => {
        const date = shanghaiDate(scheduled);
        const result = await runDaily({ ...config, dryRun: false, date });
        process.stdout.write(`${result.report.date} ${result.report.id}\n`);
      },
      {
        once: config.once,
        onScheduled: ({ next }) => process.stdout.write(`Next run: ${next.toISOString()} (23:50 Asia/Shanghai)\n`)
      }
    );
  } else {
    process.stdout.write(help());
    if (parsed.command !== 'help' && parsed.command !== '--help') process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(`${stableStringify({ error: publicError(error, knownSecrets()) })}\n`);
  process.exitCode = 1;
}

function print(value) {
  process.stdout.write(`${stableStringify(value, 2)}\n`);
}

function help() {
  return `DesignSignal 6.0\n\nUsage:\n  designsignal collect [--fixture] [--dry-run] [--date YYYY-MM-DD]\n  designsignal daily [--fixture] [--dry-run] [--date YYYY-MM-DD]\n  designsignal serve [--fixture] [--host 127.0.0.1] [--port 3379]\n  designsignal doctor\n  designsignal outbox [--retry]\n  designsignal outbox reconcile --id ID --observed absent --confirm\n  designsignal outbox reconcile --id ID --observed document --document-id ID --revision N --confirmed-blocks N --confirm\n  designsignal verify --date YYYY-MM-DD --require-channel feishu\n  designsignal schedule [--once]\n`;
}

function knownSecrets() {
  return [
    config.apiKey,
    process.env.DESIGNSIGNAL_WEBHOOK_URL,
    process.env.FEISHU_WEBHOOK_URL,
    process.env.WECOM_WEBHOOK_URL,
    process.env.FEISHU_APP_SECRET,
    process.env.FEISHU_DOC_FOLDER_TOKEN
  ].filter(Boolean);
}
