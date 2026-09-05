import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'designsignal-v6-docker-repro-'));
const suffix = `${process.pid}-${Date.now()}`;
const tags = [`designsignal-v6-repro-a:${suffix}`, `designsignal-v6-repro-b:${suffix}`];
const officialBase = 'node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd';
const mirrorBase = 'docker.m.daocloud.io/library/node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd';
const baseImage = process.env.DESIGNSIGNAL_NODE_IMAGE || (imageExists(mirrorBase) ? mirrorBase : officialBase);
const containers = [];
const builds = [];
try {
  for (const [index, tag] of tags.entries()) {
    run('docker', [
      'build',
      '--no-cache',
      '--provenance=false',
      '--sbom=false',
      '--progress=plain',
      '--build-arg',
      `NODE_IMAGE=${baseImage}`,
      '-t',
      tag,
      '.'
    ]);
    const inspect = JSON.parse(run('docker', ['image', 'inspect', tag], { capture: true }))[0];
    const container = run('docker', ['create', tag], { capture: true }).trim();
    containers.push(container);
    const destination = path.join(root, `image-${index}`);
    await fs.mkdir(destination, { recursive: true });
    run('docker', ['cp', `${container}:/app/.`, destination]);
    const manifest = await artifactManifest(destination);
    builds.push({
      tag,
      imageId: inspect.Id,
      user: inspect.Config?.User || null,
      entrypoint: inspect.Config?.Entrypoint || null,
      command: inspect.Config?.Cmd || null,
      diffIds: inspect.RootFS?.Layers || [],
      artifactSha256: sha256(JSON.stringify(manifest)),
      artifactCount: manifest.length
    });
  }
  const result = {
    schemaVersion: 'designsignal.docker-repro.v1',
    baseImage,
    builds,
    pass:
      builds.length === 2 &&
      builds[0].artifactSha256 === builds[1].artifactSha256 &&
      builds.every((build) => build.user === 'node')
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.pass) process.exitCode = 1;
} finally {
  for (const container of containers) runQuiet('docker', ['rm', '-f', container]);
  for (const tag of tags) runQuiet('docker', ['image', 'rm', '-f', tag]);
  await fs.rm(root, { recursive: true, force: true });
}

async function artifactManifest(directory) {
  const entries = [];
  await walk(directory, '');
  return entries.sort((left, right) => left.path.localeCompare(right.path));

  async function walk(current, relative) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const nextRelative = path.posix.join(relative.replaceAll('\\', '/'), entry.name);
      if (nextRelative === 'data' || nextRelative.startsWith('data/')) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute, nextRelative);
      else if (entry.isFile()) {
        const bytes = await fs.readFile(absolute);
        entries.push({ path: nextRelative, sizeBytes: bytes.length, sha256: sha256(bytes) });
      }
    }
  }
}

function run(command, args, { capture = false } = {}) {
  return execFileSync(command, args, {
    cwd: path.resolve('.'),
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    maxBuffer: 100 * 1024 * 1024
  });
}

function runQuiet(command, args) {
  try {
    execFileSync(command, args, { stdio: 'ignore' });
  } catch {
    // Best-effort cleanup does not replace the verified result.
  }
}

function imageExists(reference) {
  try {
    execFileSync('docker', ['image', 'inspect', reference], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
