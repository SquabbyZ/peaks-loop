/**
 * The materialize write path — `materializeEccAgents` copies the active
 * cache's `agents/*.md` into the peaks-owned stable dir, and
 * `materializeBestEffort` wraps it for the download path.
 *
 * Split verbatim out of `ecc-cache-service.ts` (wave 11 slice A,
 * 2026-10-03); no behaviour changed.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ECC_MATERIALIZE_VERSION,
  resolveEccMaterializedDir,
  resolveEccMaterializedManifestPath,
  resolveAgentsDir,
  setCacheDirPermissions,
  type EccMaterializeManifest
} from './ecc-cache-config.js';
import { readManifestAt } from './ecc-cache-manifest.js';
import { isSafeAgentName } from './ecc-archive-safety.js';

/**
 * Refresh the plugin-free copy after a successful download. Swallows every
 * error: `peaks ecc install` succeeds even when the materialize step cannot
 * write (read-only home, disk full, ...) — the caller falls back to inline
 * review in that case.
 */
function materializeBestEffort(cacheDir: string): void {
  try {
    materializeEccAgents({ cacheDir });
  } catch {
    /* best-effort */
  }
}

/**
 * Copy the active cache's `agents/*.md` into a stable, peaks-owned
 * directory (`~/.peaks/agents/ecc/` by default) and write a small
 * manifest. Fail-soft: an empty/missing cache yields
 * `{ sha: null, materialized: [] }` and never throws — `peaks ecc install`
 * must not fail because materialization did.
 *
 * `targetDir` is the ONLY write root (plus `mkdirSync` on it). Nothing in
 * this function can reach `~/.claude/`.
 */
export function materializeEccAgents({
  cacheDir,
  targetDir
}: { cacheDir?: string; targetDir?: string } = {}): {
  targetDir: string;
  sha: string | null;
  materialized: string[];
} {
  const resolvedTarget = targetDir ?? resolveEccMaterializedDir();
  const manifest = readManifestAt(cacheDir);
  if (manifest === null) {
    return { targetDir: resolvedTarget, sha: null, materialized: [] };
  }
  const agentsDir = resolveAgentsDir(manifest.sha, cacheDir);
  if (!existsSync(agentsDir)) {
    return { targetDir: resolvedTarget, sha: null, materialized: [] };
  }

  let entries: string[];
  try {
    entries = readdirSync(agentsDir);
  } catch {
    return { targetDir: resolvedTarget, sha: null, materialized: [] };
  }

  try {
    if (!existsSync(resolvedTarget)) mkdirSync(resolvedTarget, { recursive: true });
    setCacheDirPermissions(resolvedTarget);
  } catch {
    return { targetDir: resolvedTarget, sha: null, materialized: [] };
  }

  const materialized: string[] = [];
  for (const file of entries) {
    if (!file.endsWith('.md')) continue;
    const name = file.replace(/\.md$/i, '');
    if (!isSafeAgentName(name)) continue;
    try {
      const body = readFileSync(join(agentsDir, file), 'utf8');
      writeFileSync(join(resolvedTarget, `${name}.md`), body);
      materialized.push(name);
    } catch {
      /* fail-soft per agent */
    }
  }
  materialized.sort();

  // Prune stale copies so `readMaterializedAgent` cannot serve an agent
  // the active cache no longer ships.
  try {
    for (const existing of readdirSync(resolvedTarget)) {
      if (!existing.endsWith('.md')) continue;
      const name = existing.replace(/\.md$/i, '');
      if (!materialized.includes(name)) {
        rmSync(join(resolvedTarget, existing), { force: true });
      }
    }
  } catch {
    /* fail-soft */
  }

  const nextManifest: EccMaterializeManifest = {
    version: ECC_MATERIALIZE_VERSION,
    sha: manifest.sha,
    materializedAt: new Date().toISOString(),
    agents: materialized
  };
  try {
    writeFileSync(
      resolveEccMaterializedManifestPath(resolvedTarget),
      JSON.stringify(nextManifest, null, 2)
    );
  } catch {
    /* fail-soft */
  }

  return { targetDir: resolvedTarget, sha: manifest.sha, materialized };
}

// Cross-module glue: private inside ecc-cache-service.ts before the split.
export { materializeBestEffort };
