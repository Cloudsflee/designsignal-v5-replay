import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const roots = ['bin', 'src', 'scripts'];
const files = [];
for (const root of roots) await collect(path.resolve(root));
for (const file of files.sort()) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
process.stdout.write(`syntax passed: ${files.length} ESM files\n`);

async function collect(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(target);
    else if (entry.isFile() && entry.name.endsWith('.mjs')) files.push(target);
  }
}
