/**
 * 7-day TTL sweep over the ECC sha cache (`cleanupStaleCache`, used by
 * `src/services/log/retention.ts` through the package barrel).
 *
 * Split verbatim out of `ecc-cache-service.ts` (wave 11 slice A,
 * 2026-10-03); no behaviour changed.
 */

import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { resolveEccCacheDir, resolveManifestPath } from './ecc-cache-config.js';
import { readCacheManifest } from './ecc-cache-manifest.js';

/**
 * 7-day TTL sweep over `ecc-<sha>/` directories.
 *
 * - Active cache (per manifest `sha`): use `fetchedAt` as the
 *   age source; remove if older than `retentionDays`.
 * - Orphan caches (any other `ecc-<40hex>` directory): use
 *   directory `mtimeMs` as the age source.
 * - If the active cache is removed, invalidate the manifest.
 *
 * Returns the absolute paths of the removed directories.
 */
export function cleanupStaleCache({
  retentionDays,
  nowMs,
  dirOverride
}: {
  retentionDays: number;
  nowMs: number;
  dirOverride?: string;
}): { removed: string[] } {
  const cacheDir = dirOverride ?? resolveEccCacheDir();
  if (!existsSync(cacheDir)) return { removed: [] };

  const dayMs = 24 * 60 * 60 * 1000;
  const cutoff = nowMs - retentionDays * dayMs;
  const manifest = readCacheManifest();
  const activeSha = manifest?.sha ?? null;
  const activeFetchedAt = manifest?.fetchedAt ? Date.parse(manifest.fetchedAt) : NaN;

  const removed: string[] = [];
  let names: string[];
  try {
    names = readdirSync(cacheDir);
  } catch {
    return { removed: [] };
  }

  for (const name of names) {
    const match = /^ecc-([0-9a-f]{40})$/.exec(name);
    if (match === null) continue;
    const sha = match[1] ?? '';
    const fullPath = join(cacheDir, name);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    let ageMs: number;
    if (sha === activeSha && Number.isFinite(activeFetchedAt)) {
      ageMs = nowMs - activeFetchedAt;
    } else {
      ageMs = nowMs - stat.mtimeMs;
    }
    removeExpiredCacheDir({ ageMs, retentionDays, dayMs, fullPath, removed });
  }

  invalidateManifestIfActiveRemoved({ activeSha, removed, cacheDir });

  return { removed };
}

function removeExpiredCacheDir(ctx: {
  ageMs: number;
  retentionDays: number;
  dayMs: number;
  fullPath: string;
  removed: string[];
}): void {
  const { ageMs, retentionDays, dayMs, fullPath, removed } = ctx;
  if (ageMs > retentionDays * dayMs) {
    try {
      rmSync(fullPath, { recursive: true, force: true });
      removed.push(fullPath);
    } catch {
      /* best-effort */
    }
  }
}

function invalidateManifestIfActiveRemoved(ctx: {
  activeSha: string | null;
  removed: string[];
  cacheDir: string;
}): void {
  const { activeSha, removed, cacheDir } = ctx;
  // Invalidate manifest if active cache was removed.
  if (activeSha !== null && removed.some((p) => p.includes(`ecc-${activeSha}`))) {
    try {
      rmSync(resolveManifestPath(cacheDir), { force: true });
    } catch {
      /* best-effort */
    }
  }
}
