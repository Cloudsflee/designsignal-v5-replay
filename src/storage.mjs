import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { renderPortableHtml, renderReportMarkdown } from './report.mjs';
import { sha256, stableStringify } from './util.mjs';

export async function withDateLock(dataDir, date, operation, { now = () => new Date(), staleAfterMs = 12 * 60 * 60 * 1000 } = {}) {
  const lockDir = path.join(dataDir, '.locks');
  const lockPath = path.join(lockDir, `${date}.lock`);
  await fs.mkdir(lockDir, { recursive: true });
  let handle;
  try {
    handle = await openLock(lockPath, now, staleAfterMs);
    return await operation();
  } finally {
    await handle?.close().catch(() => undefined);
    if (handle) await fs.unlink(lockPath).catch(() => undefined);
  }
}

async function openLock(lockPath, now, staleAfterMs) {
  try {
    const handle = await fs.open(lockPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: now().toISOString() })}\n`);
    await handle.sync();
    return handle;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const stat = await fs.stat(lockPath).catch(() => null);
    if (stat && now().getTime() - stat.mtimeMs > staleAfterMs) {
      await fs.rename(lockPath, `${lockPath}.stale-${randomUUID()}`).catch(() => undefined);
      return openLock(lockPath, now, staleAfterMs);
    }
    const locked = new Error('daily_date_locked');
    locked.code = 'daily_date_locked';
    locked.lockPath = lockPath;
    throw locked;
  }
}

export async function atomicWrite(filePath, content, { mode = 0o600, overwrite = true } = {}) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', mode);
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = null;
    if (!overwrite) {
      try {
        await fs.access(filePath);
        const exists = new Error('atomic_destination_exists');
        exists.code = 'atomic_destination_exists';
        throw exists;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    await replaceFile(temporary, filePath);
    await syncDirectory(directory);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await fs.unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function replaceFile(source, destination) {
  try {
    await fs.rename(source, destination);
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
    const backup = `${destination}.replace-${randomUUID()}`;
    let moved = false;
    try {
      await fs.rename(destination, backup);
      moved = true;
      await fs.rename(source, destination);
      await fs.unlink(backup).catch(() => undefined);
    } catch (replaceError) {
      if (moved) await fs.rename(backup, destination).catch(() => undefined);
      throw replaceError;
    }
  }
}

export async function persistReport(dataDir, report, { lock = true } = {}) {
  const operation = async () => {
    const reportsRoot = path.join(dataDir, 'reports');
    const reportDir = path.join(reportsRoot, report.date);
    const stagingDir = path.join(reportsRoot, `.${report.date}.stage-${process.pid}-${randomUUID()}`);
    await fs.mkdir(stagingDir, { recursive: true });
    const files = [
      { name: 'report.json', content: `${stableStringify(report, 2)}\n`, mediaType: 'application/json' },
      { name: 'report.md', content: renderReportMarkdown(report), mediaType: 'text/markdown' },
      { name: 'report.html', content: renderPortableHtml(report), mediaType: 'text/html' }
    ];
    const manifestFiles = [];
    try {
      for (const file of files) {
        const destination = path.join(stagingDir, file.name);
        await atomicWrite(destination, file.content, { overwrite: false });
        manifestFiles.push({
          path: path.relative(dataDir, path.join(reportDir, file.name)).replaceAll('\\', '/'),
          mediaType: file.mediaType,
          sizeBytes: Buffer.byteLength(file.content),
          sha256: sha256(file.content)
        });
      }
      await fs.rename(stagingDir, reportDir);
      await syncDirectory(reportsRoot);
    } catch (error) {
      await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
      if (['EEXIST', 'EPERM'].includes(error.code)) {
        const exists = new Error('daily_report_exists');
        exists.code = 'daily_report_exists';
        throw exists;
      }
      throw error;
    }
    await atomicWrite(path.join(dataDir, 'reports', 'latest.json'), `${stableStringify(report, 2)}\n`);
    const entry = {
      schemaVersion: 'designsignal.manifest-entry.v1',
      reportId: report.id,
      date: report.date,
      generatedAt: report.generatedAt,
      integritySha256: report.integrity.contentSha256,
      files: manifestFiles
    };
    await appendManifest(path.join(dataDir, 'manifest.jsonl'), entry);
    return { reportDir, files: manifestFiles, manifestEntry: entry };
  };
  return lock ? withDateLock(dataDir, report.date, operation) : operation();
}

export async function appendManifest(filePath, entry) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const handle = await fs.open(filePath, 'a', 0o600);
  try {
    await handle.writeFile(`${stableStringify(entry)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function readLatestReport(dataDir) {
  try {
    return JSON.parse(await fs.readFile(path.join(dataDir, 'reports', 'latest.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function readReport(dataDir, date) {
  try {
    return JSON.parse(await fs.readFile(path.join(dataDir, 'reports', date, 'report.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function readHistory(dataDir, maximumDays = 60) {
  const root = path.join(dataDir, 'reports');
  const names = await fs.readdir(root).catch((error) => (error.code === 'ENOENT' ? [] : Promise.reject(error)));
  const dates = names.filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name)).sort().slice(-maximumDays);
  const reports = [];
  for (const date of dates) {
    const report = await readReport(dataDir, date);
    if (report) reports.push(report);
  }
  return reports;
}

async function syncDirectory(directory) {
  try {
    const handle = await fs.open(directory, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (process.platform !== 'win32') throw error;
  }
}
