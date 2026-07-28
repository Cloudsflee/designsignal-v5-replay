import { shanghaiParts } from './util.mjs';

export function nextShanghaiRun(value = new Date()) {
  const now = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(now.getTime())) throw new TypeError('invalid_date');
  const parts = shanghaiParts(now);
  let target = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 15, 50, 0));
  if (target.getTime() <= now.getTime()) target = new Date(target.getTime() + 86_400_000);
  return target;
}

export function scheduleDelay(value = new Date()) {
  return Math.max(0, nextShanghaiRun(value).getTime() - new Date(value).getTime());
}

export async function runSchedule(runDaily, { once = false, now = () => new Date(), setTimer = setTimeout, onScheduled } = {}) {
  for (;;) {
    const current = now();
    const next = nextShanghaiRun(current);
    onScheduled?.({ next, delayMs: next.getTime() - current.getTime() });
    await new Promise((resolve) => {
      setTimer(resolve, Math.max(0, next.getTime() - current.getTime()));
    });
    await runDaily(next);
    if (once) return;
  }
}
