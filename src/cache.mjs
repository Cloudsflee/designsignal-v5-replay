import fs from 'node:fs/promises';
import path from 'node:path';
import { appendManifest, atomicWrite } from './storage.mjs';
import { sha256 } from './util.mjs';

export async function cacheSourceResponse(dataDir, { source, bytes, fetchedAt, mimeType, url, parsed }) {
  const digest = sha256(bytes);
  const relative = path.join('cache', 'blobs', digest.slice(0, 2), digest);
  const destination = path.join(dataDir, relative);
  try {
    await fs.access(destination);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try {
      await atomicWrite(destination, bytes, { overwrite: false });
    } catch (writeError) {
      if (writeError.code !== 'atomic_destination_exists') throw writeError;
    }
  }
  const metadata = {
    schemaVersion: 'designsignal.source-cache.v1',
    sourceId: source.id,
    adapter: source.kind,
    url,
    fetchedAt,
    mimeType,
    sizeBytes: bytes.length,
    sha256: digest,
    blobRef: relative.replaceAll('\\', '/'),
    authors: [...new Set(parsed.flatMap((item) => item.authors || []))],
    institutions: [...new Set(parsed.map((item) => item.source?.institution).filter(Boolean))],
    access: parsed.map((item) => ({ id: item.id, ...item.access })),
    licenses: parsed.map((item) => ({ id: item.id, ...item.license }))
  };
  await appendManifest(path.join(dataDir, 'cache', 'index.jsonl'), metadata);
  return metadata;
}
