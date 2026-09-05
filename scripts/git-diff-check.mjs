import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const index = path.join(os.tmpdir(), `designsignal-v6-diff-index-${process.pid}-${Date.now()}`);
const environment = { ...process.env, GIT_INDEX_FILE: index };
try {
  run(['read-tree', 'HEAD']);
  run(['add', '-A', '--', '.']);
  run(['diff', '--cached', '--check', 'HEAD', '--', '.']);
  process.stdout.write('git diff --check passed for tracked and untracked changes\n');
} finally {
  await fs.rm(index, { force: true });
}

function run(args) {
  execFileSync('git', args, { cwd: path.resolve('.'), env: environment, stdio: 'inherit' });
}
