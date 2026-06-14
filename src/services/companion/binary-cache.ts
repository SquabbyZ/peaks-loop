/**
 * Slice 2026-06-14-cc-connect-weixin (slice 1) — binary path cache.
 * Persists the resolved cc-connect binary path + version to
 * `~/.peaks/companion/cc-connect-binary-path.txt` so the rest of
 * peaks-cli's companion code path doesn't re-walk PATH on every
 * CLI invocation. The cache is a plain text file (one line, pipe-
 * separated) so users can `cat` it during troubleshooting.
 *
 * The cache is best-effort: a corrupt or missing file is treated
 * as "no cached value" and the resolver runs from scratch. We do
 * not crash when `~/.peaks/` is unwritable.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { CompanionBinaryCacheRecord } from './companion-types.js';

export const COMPANION_HOME_DIRNAME = '.peaks';
export const COMPANION_COMPANION_DIRNAME = 'companion';
export const COMPANION_BINARY_PATH_FILENAME = 'cc-connect-binary-path.txt';

export function companionHomeDir(home: string = homedir()): string {
  return join(home, COMPANION_HOME_DIRNAME, COMPANION_COMPANION_DIRNAME);
}

export function binaryPathCacheFile(home: string = homedir()): string {
  return join(companionHomeDir(home), COMPANION_BINARY_PATH_FILENAME);
}

/** Serialize a cache record to a single pipe-separated line. */
export function serializeCacheRecord(record: CompanionBinaryCacheRecord): string {
  return `${record.binaryPath}|${record.version}|${record.resolvedAt}|${record.source}`;
}

/** Deserialize a cache record from a single line. Returns null when malformed. */
export function parseCacheRecord(raw: string): CompanionBinaryCacheRecord | null {
  const line = raw.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
  if (line === undefined) return null;
  const parts = line.split('|');
  if (parts.length < 4) return null;
  const [binaryPath, version, resolvedAt, ...sourceParts] = parts as [string, string, string, ...string[]];
  if (binaryPath.length === 0 || version.length === 0 || resolvedAt.length === 0) return null;
  const source = sourceParts.join('|');
  return { binaryPath, version, resolvedAt, source: source.length > 0 ? source : 'UNKNOWN' };
}

/** Read the cached binary path record, or null if absent / malformed / missing. */
export function readBinaryPathCache(home: string = homedir()): CompanionBinaryCacheRecord | null {
  const file = binaryPathCacheFile(home);
  if (!existsSync(file)) return null;
  try {
    const raw = readFileSync(file, 'utf8');
    return parseCacheRecord(raw);
  } catch {
    return null;
  }
}

/**
 * Write the cache. Best-effort: silently swallows errors so the
 * CLI never crashes because `~/.peaks/companion/` is unwritable
 * (e.g. on a read-only filesystem or sandboxed CI).
 */
export function writeBinaryPathCache(
  record: CompanionBinaryCacheRecord,
  home: string = homedir(),
  options: { mkdir?: boolean } = {}
): { ok: boolean; path: string; error: string | null } {
  const file = binaryPathCacheFile(home);
  try {
    if (options.mkdir !== false) {
      mkdirSync(dirname(file), { recursive: true });
    }
    writeFileSync(file, serializeCacheRecord(record) + '\n', 'utf8');
    return { ok: true, path: file, error: null };
  } catch (err) {
    return { ok: false, path: file, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Clear the cache. Best-effort. */
export function clearBinaryPathCache(home: string = homedir()): { ok: boolean; removed: boolean } {
  const file = binaryPathCacheFile(home);
  if (!existsSync(file)) return { ok: true, removed: false };
  try {
    const { unlinkSync } = require('node:fs') as typeof import('node:fs');
    unlinkSync(file);
    return { ok: true, removed: true };
  } catch {
    return { ok: false, removed: false };
  }
}
