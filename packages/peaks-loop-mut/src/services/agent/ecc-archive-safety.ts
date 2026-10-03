/**
 * ECC archive safety — agent-name allowlist and tar entry validation.
 *
 * This is the security-relevant seam: path traversal (`..`), absolute
 * paths and drive letters, the synthetic GitHub root, symlink/dir type
 * flags, and the `agents/<name>.md` allowlist are all rejected here before
 * anything is written to disk. Split verbatim out of
 * `ecc-cache-service.ts` (wave 11 slice A, 2026-10-03); no behaviour
 * changed.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function isSafeAgentName(name: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(name);
}

/**
 * GitHub prefixes every tarball entry with a synthetic root dir —
 * `<repo>-<sha>` on codeload, `<owner>-<repo>-<sha>` on the API tarball
 * endpoint. Match on shape, not on the repo name, so a rename (or either
 * endpoint) cannot silently zero out the extraction.
 */
function stripTarballRootSegments(entryName: string): string[] {
  const segments = entryName.split('/');
  if (segments.length >= 3 && segments[0] !== 'agents') segments.shift();
  return segments;
}

function isSafeArchiveEntry(entryName: string): boolean {
  if (entryName.length === 0) return false;
  if (entryName.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(entryName)) return false;
  if (entryName.includes('..')) return false;
  // After dropping the synthetic root, everything must be exactly
  // "agents/<name>.md" at a single level.
  const segments = stripTarballRootSegments(entryName);
  if (segments.length !== 2) return false;
  return segments[0] === 'agents' && segments[1]?.endsWith('.md') === true;
}

function safeAgentNameFromEntry(entryName: string): string | null {
  const segments = stripTarballRootSegments(entryName);
  const file = segments[segments.length - 1] ?? '';
  const base = file.replace(/\.md$/i, '');
  return isSafeAgentName(base) ? base : null;
}

/**
 * Tiny tar.gz extractor. Public-domain-compatible tar parser:
 *   - reads 512-byte header blocks
 *   - validates name + size
 *   - rejects anything that is not a regular file at a safe path
 *   - filters to the `agents/*.md` allowlist via isSafeArchiveEntry
 *
 * We do NOT decompress gzip via a third-party lib; Node's
 * `node:zlib` ships with `gunzip` so the implementation is
 * self-contained.
 */
async function extractAgentsFromTarGz(buffer: Uint8Array, outDir: string): Promise<string[]> {
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const extracted: string[] = [];

  // Lazy import to keep the cold path cheap.
  const { gunzipSync } = await import('node:zlib');
  let tar: Uint8Array;
  try {
    tar = gunzipSync(buffer);
  } catch {
    return [];
  }

  const BLOCK = 512;
  let offset = 0;
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    // Two consecutive zero blocks mark end-of-archive.
    if (header.every((b) => b === 0)) break;
    const name = readCString(header, 0, 100);
    if (name === null || name.length === 0) break;
    const sizeOctal = readCString(header, 124, 12);
    if (sizeOctal === null) break;
    const size = parseOctal(sizeOctal);
    if (size === null) break;
    const typeFlag = String.fromCharCode(header[156] ?? 0);
    // '0' or '\0' = regular file. Reject symlinks (2), dirs (5), etc.
    if (typeFlag !== '0' && typeFlag !== '\0') {
      offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
      continue;
    }
    if (!isSafeArchiveEntry(name)) {
      offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
      continue;
    }
    const safeName = safeAgentNameFromEntry(name);
    if (safeName === null) {
      offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
      continue;
    }
    const data = tar.subarray(offset + BLOCK, offset + BLOCK + size);
    writeFileSync(join(outDir, `${safeName}.md`), data);
    extracted.push(safeName);
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
  return extracted;
}

function readCString(buf: Uint8Array, start: number, len: number): string | null {
  let end = start;
  while (end < start + len && buf[end] !== 0) end += 1;
  if (end === start) return '';
  try {
    return Buffer.from(buf.subarray(start, end)).toString('utf8');
  } catch {
    return null;
  }
}

function parseOctal(value: string): number | null {
  const trimmed = value.trim().replace(/\0+$/g, '');
  if (trimmed.length === 0) return 0;
  const n = Number.parseInt(trimmed, 8);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Cross-module glue: private inside ecc-cache-service.ts before the split.
export { isSafeAgentName, extractAgentsFromTarGz };
