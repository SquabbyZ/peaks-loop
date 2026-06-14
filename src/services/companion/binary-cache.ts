/**
 * Slice 2026-06-14-cc-connect-weixin (slice 1 + change-1) — binary path cache.
 *
 * Legacy: persisted the resolved cc-connect binary path + version
 * to `~/.peaks/companion/cc-connect-binary-path.txt` so the rest
 * of peaks-cli's companion code path didn't re-walk PATH on every
 * CLI invocation. The cache was a plain text file (one line,
 * pipe-separated) so users could `cat` it during troubleshooting.
 *
 * Change-1: peaks config (`~/.peaks/config.json#companion`) is
 * now the source of truth for the resolved binary path +
 * source. We still write the legacy txt file so older peaks-cli
 * builds (and human `cat` troubleshooting) keep working; reads
 * prefer the txt cache when present and fall back to peaks config
 * (slice change-1 source of truth). On a successful write we
 * also mirror into peaks config so `peaks companion status` and
 * `peaks doctor` can render the resolution without touching the
 * filesystem cache.
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

/**
 * Map the legacy txt-cache `source` field to the typed
 * `binaryPathSource` enum that lives in peaks config
 * (slice change-1).
 */
export function sourceToCompanionBinarySource(source: string): 'node-modules' | 'path' | null {
  const upper = source.toUpperCase();
  if (upper === 'NODE_MODULES' || upper === 'NODE-MODULES') return 'node-modules';
  if (upper === 'PATH' || upper === 'PATH_CACHE' || upper === 'BREW' || upper === 'MANUAL') return 'path';
  return null;
}

/**
 * Read the cached binary path record. Prefers the legacy txt file
 * when present; falls back to peaks config (`companion.binaryPath`).
 * Returns null when neither is populated.
 */
export function readBinaryPathCache(home: string = homedir()): CompanionBinaryCacheRecord | null {
  const file = binaryPathCacheFile(home);
  if (!existsSync(file)) {
    return readBinaryPathCacheFromPeaksConfig(home);
  }
  try {
    const raw = readFileSync(file, 'utf8');
    return parseCacheRecord(raw);
  } catch {
    return null;
  }
}

/**
 * Slice change-1: read the binary path resolution from peaks
 * config. Returns null when peaks config is absent or the
 * `companion` block is missing.
 */
export function readBinaryPathCacheFromPeaksConfig(home: string = homedir()): CompanionBinaryCacheRecord | null {
  const configPath = join(home, COMPANION_HOME_DIRNAME, 'config.json');
  if (!existsSync(configPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf8')) as { companion?: { binaryPath?: string | null; binaryPathSource?: 'node-modules' | 'path' | null; weixin?: { ilinkQrPayload?: string } } };
    const c = raw.companion;
    if (c === undefined || c.binaryPath === null || c.binaryPath === undefined || c.binaryPath.length === 0) return null;
    const source = c.binaryPathSource ?? null;
    return {
      binaryPath: c.binaryPath,
      version: '',
      resolvedAt: '',
      source: source === 'node-modules' ? 'NODE_MODULES' : source === 'path' ? 'PATH' : 'PEAKS_CONFIG'
    };
  } catch {
    return null;
  }
}

/**
 * Write the cache. Best-effort: silently swallows errors so the
 * CLI never crashes because `~/.peaks/companion/` is unwritable
 * (e.g. on a read-only filesystem or sandboxed CI).
 *
 * Slice change-1: also mirrors the resolution into
 * `~/.peaks/config.json#companion` so subsequent
 * `peaks companion status` / `peaks doctor` reads don't depend on
 * the legacy txt file. The peaks-config write is itself
 * best-effort (we never throw from a cache writer).
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
    mirrorBinaryPathToPeaksConfig(record, home);
    return { ok: true, path: file, error: null };
  } catch (err) {
    return { ok: false, path: file, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Best-effort mirror of the resolved binary path + source into
 * `~/.peaks/config.json#companion`. Errors are swallowed; the
 * peaks-config write is incremental (we never nuke other
 * config keys).
 */
export function mirrorBinaryPathToPeaksConfig(
  record: CompanionBinaryCacheRecord,
  home: string = homedir()
): { ok: boolean; path: string; error: string | null } {
  const configPath = join(home, COMPANION_HOME_DIRNAME, 'config.json');
  try {
    const existing = existsSync(configPath)
      ? (JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>)
      : {};
    const previousCompanion = (existing['companion'] !== null && typeof existing['companion'] === 'object' && !Array.isArray(existing['companion']))
      ? (existing['companion'] as Record<string, unknown>)
      : {};
    const merged: Record<string, unknown> = {
      ...previousCompanion,
      binaryPath: record.binaryPath,
      binaryPathSource: sourceToCompanionBinarySource(record.source)
    };
    existing['companion'] = merged;
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(existing, null, 2) + '\n', 'utf8');
    return { ok: true, path: configPath, error: null };
  } catch (err) {
    return { ok: false, path: configPath, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Clear the cache. Best-effort. Removes both the legacy txt file
 *  AND the peaks-config mirror so subsequent reads return null. */
export function clearBinaryPathCache(home: string = homedir()): { ok: boolean; removed: boolean } {
  const file = binaryPathCacheFile(home);
  const peaksConfigPath = join(home, COMPANION_HOME_DIRNAME, 'config.json');
  let removedAny = false;
  try {
    const { unlinkSync } = require('node:fs') as typeof import('node:fs');
    if (existsSync(file)) {
      unlinkSync(file);
      removedAny = true;
    }
  } catch {
    /* best-effort */
  }
  try {
    if (existsSync(peaksConfigPath)) {
      const raw = JSON.parse(readFileSync(peaksConfigPath, 'utf8')) as Record<string, unknown>;
      const companion = raw['companion'];
      if (companion !== null && typeof companion === 'object' && !Array.isArray(companion)) {
        const c = companion as Record<string, unknown>;
        if (c['binaryPath'] !== null && c['binaryPath'] !== undefined) {
          c['binaryPath'] = null;
          c['binaryPathSource'] = null;
          raw['companion'] = c;
          writeFileSync(peaksConfigPath, JSON.stringify(raw, null, 2) + '\n', 'utf8');
          removedAny = true;
        }
      }
    }
  } catch {
    /* best-effort */
  }
  return { ok: true, removed: removedAny };
}
