#!/usr/bin/env node

import { doctor, runCollect, runDaily } from '../src/app.mjs';
import { parseCli, resolveConfig } from '../src/config.mjs';
import { outboxStatus, processOutbox } from '../src/outbox.mjs';
import { runSchedule } from '../src/scheduler.mjs';
import { startServer } from '../src/server.mjs';
import { publicError, shanghaiDate, stableStringify } from '../src/util.mjs';

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
        complete: result.report.selection.complete,
        reportDir: result.persistence?.reportDir || null,
        outboxCount: result.outbox.length
      });
  } else if (parsed.command === 'doctor') {
    const result = await doctor(config);
    print(result);
    if (!result.ok) process.exitCode = 1;
  } else if (parsed.command === 'outbox') {
    const retry = Boolean(parsed.options.retry || parsed.options.process);
    const processed = retry ? await processOutbox(config.dataDir) : [];
    const status = await outboxStatus(config.dataDir);
    print({
      schemaVersion: 'designsignal.outbox-status.v1',
      retry,
      processedCount: processed.length,
      total: status.total,
      pending: status.pending,
      sent: status.sent,
      failed: status.failed,
      messages: status.messages
    });
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
  process.stderr.write(`${stableStringify({ error: publicError(error, [config.apiKey]) })}\n`);
  process.exitCode = 1;
}

function print(value) {
  process.stdout.write(`${stableStringify(value, 2)}\n`);
}

function help() {
  return `DesignSignal 5.0\n\nUsage:\n  designsignal collect [--fixture] [--dry-run] [--date YYYY-MM-DD]\n  designsignal daily [--fixture] [--dry-run] [--date YYYY-MM-DD]\n  designsignal serve [--fixture] [--host 127.0.0.1] [--port 3379]\n  designsignal doctor\n  designsignal outbox [--retry]\n  designsignal schedule [--once]\n`;
}
