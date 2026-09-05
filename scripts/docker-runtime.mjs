import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const suffix = `${process.pid}-${Date.now()}`;
const tag = `designsignal-v6-runtime:${suffix}`;
const name = `designsignal-v6-runtime-${suffix}`;
const volume = `designsignal-v6-runtime-data-${suffix}`;
const officialBase = 'node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd';
const mirrorBase = 'docker.m.daocloud.io/library/node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd';
const baseImage = process.env.DESIGNSIGNAL_NODE_IMAGE || (imageExists(mirrorBase) ? mirrorBase : officialBase);
try {
  run('docker', ['build', '--provenance=false', '--sbom=false', '--build-arg', `NODE_IMAGE=${baseImage}`, '-t', tag, '.']);
  run('docker', ['volume', 'create', volume], true);
  run(
    'docker',
    [
      'run',
      '-d',
      '--name',
      name,
      '--read-only',
      '--cap-drop=ALL',
      '--security-opt',
      'no-new-privileges:true',
      '--tmpfs',
      '/tmp:size=32m,mode=1777',
      '--mount',
      `type=volume,source=${volume},target=/app/data`,
      '-p',
      '127.0.0.1::3379',
      tag
    ],
    true
  );
  const portText = run('docker', ['port', name, '3379/tcp'], true).trim();
  const port = Number(/:(\d+)$/.exec(portText)?.[1]);
  const health = await waitForHealth(`http://127.0.0.1:${port}/healthz`);
  const inspect = JSON.parse(run('docker', ['inspect', name], true))[0];
  const rootWrite = spawnSync('docker', ['exec', name, 'sh', '-c', 'touch /app/root-write-must-fail'], { encoding: 'utf8' });
  const dataWrite = spawnSync('docker', ['exec', name, 'sh', '-c', 'touch /app/data/write-ok && rm /app/data/write-ok'], { encoding: 'utf8' });
  const compose = await fs.readFile(path.resolve('compose.yml'), 'utf8');
  const result = {
    schemaVersion: 'designsignal.docker-runtime.v1',
    baseImage,
    user: inspect.Config?.User || null,
    readOnlyRoot: inspect.HostConfig?.ReadonlyRootfs === true,
    capDrop: inspect.HostConfig?.CapDrop || [],
    securityOpt: inspect.HostConfig?.SecurityOpt || [],
    health,
    rootWriteExit: rootWrite.status,
    dataWriteExit: dataWrite.status,
    schedulerConfigured:
      /scheduler:[\s\S]*command:\s*\["node",\s*"\.\/bin\/designsignal\.mjs",\s*"schedule"\]/.test(compose) &&
      /designsignal-v6-data:\/app\/data/.test(compose),
    pass: false
  };
  result.pass =
    result.user === 'node' &&
    result.readOnlyRoot &&
    result.capDrop.includes('ALL') &&
    result.securityOpt.some((entry) => entry.includes('no-new-privileges')) &&
    health.status === 'ok' &&
    rootWrite.status !== 0 &&
    dataWrite.status === 0 &&
    result.schedulerConfigured;
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.pass) process.exitCode = 1;
} finally {
  runQuiet('docker', ['rm', '-f', name]);
  runQuiet('docker', ['volume', 'rm', '-f', volume]);
  runQuiet('docker', ['image', 'rm', '-f', tag]);
}

async function waitForHealth(url) {
  let lastError = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      lastError = `http_${response.status}`;
    } catch (error) {
      lastError = error.code || error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`docker_health_timeout:${lastError}`);
}

function run(command, args, capture = false) {
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
    // Best-effort cleanup.
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
