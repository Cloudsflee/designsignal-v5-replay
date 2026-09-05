import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const output = path.resolve(process.env.DESIGNSIGNAL_RELEASE_DIR || path.join('.tmp', 'v6-delivery'));
await fs.mkdir(output, { recursive: true });
const base = '5833494e6fdc16201cc10ec8776578892e8d85b4';
const index = path.join(os.tmpdir(), `designsignal-v6-index-${process.pid}-${Date.now()}`);
const gitEnvironment = { ...process.env, GIT_INDEX_FILE: index };
const patchPath = path.join(output, 'change.patch');
const archivePath = path.join(output, 'modified-artifact.tgz');
const rollbackPath = path.join(output, 'rollback.ps1');
try {
  run('git', ['read-tree', base], { env: gitEnvironment });
  run('git', ['add', '-A', '--', '.'], { env: gitEnvironment });
  const modifiedTree = run('git', ['write-tree'], { env: gitEnvironment, capture: true }).trim();
  const patch = run('git', ['diff', '--cached', '--binary', '--full-index', '--no-ext-diff', base, '--', '.'], {
    env: gitEnvironment,
    capture: true,
    maxBuffer: 200 * 1024 * 1024
  });
  if (!patch.trim()) throw new Error('release_patch_empty');
  await fs.writeFile(patchPath, patch);
  run('git', ['apply', '--reverse', '--check', '--binary', '--whitespace=nowarn', patchPath]);

  run('git', ['-c', 'core.autocrlf=false', 'archive', '--format=tar.gz', '--output', archivePath, modifiedTree]);
  await fs.copyFile(path.resolve('scripts', 'rollback.ps1'), rollbackPath);
  const artifacts = [];
  for (const file of [archivePath, patchPath, rollbackPath]) {
    const bytes = await fs.readFile(file);
    artifacts.push({
      role: path.basename(file),
      path: path.basename(file),
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex')
    });
  }
  const result = {
    schemaVersion: 'designsignal.release-artifact-manifest.v1',
    baseCommit: base,
    modifiedTree,
    branch: run('git', ['branch', '--show-current'], { capture: true }).trim(),
    artifacts,
    pass: artifacts.length === 3
  };
  await fs.writeFile(path.join(output, 'artifact-manifest.json'), `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await fs.rm(index, { force: true });
}

function run(command, args, { env = process.env, capture = false, maxBuffer = 20 * 1024 * 1024 } = {}) {
  return execFileSync(command, args, {
    cwd: path.resolve('.'),
    env,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    maxBuffer
  });
}
