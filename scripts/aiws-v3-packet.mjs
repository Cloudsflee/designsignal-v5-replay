import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const catalogPath = path.resolve('docs', 'aiws-v3', 'context-materials.json');
const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
const materials = [];
for (const item of catalog.materials) {
  const file = path.resolve(item.path);
  const relative = path.relative(path.resolve('.'), file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('aiws_context_path_outside_repository');
  const bytes = await fs.readFile(file);
  materials.push({ id: item.id, path: item.path, label: item.label, required: item.required, sizeBytes: bytes.length, sha256: sha256(bytes) });
}
for (const required of ['brief.json', 'workflow.json', 'experiment.json']) {
  const file = path.resolve('docs', 'aiws-v3', required);
  const bytes = await fs.readFile(file);
  JSON.parse(bytes.toString('utf8'));
  materials.push({ id: required.replace('.json', ''), path: path.relative('.', file).replaceAll('\\', '/'), required: true, sizeBytes: bytes.length, sha256: sha256(bytes) });
}
const result = {
  schemaVersion: 'designsignal.aiws-packet-receipt.v1',
  project: catalog.project,
  materials: materials.sort((left, right) => left.id.localeCompare(right.id)),
  frozenAiwsCommit: '5f2be38845d36236637c7f22a1b4df5611a6175b',
  productBaselineCommit: '5833494e6fdc16201cc10ec8776578892e8d85b4',
  fingerprint: null
};
result.fingerprint = sha256(JSON.stringify(result));
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
