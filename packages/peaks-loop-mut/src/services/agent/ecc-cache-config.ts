/**
 * ECC cache constants, public types and path resolution — the single source
 * of truth for the cache layout (`~/.peaks/cache`) and the plugin-free
 * materialize target (`~/.peaks/agents/ecc`).
 *
 * Split verbatim out of `ecc-cache-service.ts` (wave 11 slice A,
 * 2026-10-03); no behaviour changed. `homedir()` is called per resolution,
 * so the `node:os` mock in the ecc tests takes effect through this module
 * as long as it is loaded via the facade's delayed import (T2).
 */

import { chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const ECC_REPO_OWNER = 'affaan-m';
// Upstream renamed `everything-claude-code` -> `ECC` on 2026-09; GitHub
// 301-redirects the old name but we keep the current one to avoid the hop.
export const ECC_REPO_NAME = 'ECC';
const ECC_CACHE_VERSION = '1';
const ECC_MATERIALIZE_VERSION = '1';
const ECC_TARBALL_BASENAME = 'ecc.tar.gz';
// GitHub's API tarball endpoint 415s on `application/octet-stream`.
const GITHUB_API_ACCEPT = 'application/vnd.github+json';

export type CacheManifest = {
  version: string;
  sha: string;
  fetchedAt: string;
  agents: string[];
};

export type DownloadResult = {
  sha: string;
  agents: number;
};

/**
 * Peaks-owned materialize manifest. Written next to the normalized
 * agent copies under `~/.peaks/agents/ecc/`. Unlike the cache manifest
 * (which points at a sha dir), this one records the *stable* copy the
 * plugin-free dispatch path reads when no ECC Claude Code plugin is
 * installed.
 */
export type EccMaterializeManifest = {
  version: string;
  sha: string;
  materializedAt: string;
  agents: string[];
};

/**
 * Cache dir resolution — single source of truth. Tests inject
 * via `dirOverride` on the functions that take one.
 */
export function resolveEccCacheDir(): string {
  return join(homedir(), '.peaks', 'cache');
}

export function resolveManifestPath(dirOverride?: string): string {
  return join(dirOverride ?? resolveEccCacheDir(), 'ecc-installed.json');
}

export function resolveShaDir(sha: string, dirOverride?: string): string {
  return join(dirOverride ?? resolveEccCacheDir(), `ecc-${sha}`);
}

export function resolveAgentsDir(sha: string, dirOverride?: string): string {
  return join(resolveShaDir(sha, dirOverride), 'agents');
}

/**
 * Plugin-free materialize target: `~/.peaks/agents/ecc/`.
 *
 * Deliberately NOT under `~/.claude/` — peaks-loop must never write into
 * the user's Claude Code tree (user direction 2026-09-09). The LLM reads
 * `<target>/<agent-name>.md` directly when the ECC Claude Code plugin is
 * absent, then dispatches a generic sub-agent with that body.
 */
export function resolveEccMaterializedDir(): string {
  return join(homedir(), '.peaks', 'agents', 'ecc');
}

export function resolveEccMaterializedManifestPath(dirOverride?: string): string {
  return join(dirOverride ?? resolveEccMaterializedDir(), 'ecc-agents.json');
}

/**
 * Best-effort chmod 0o700 on POSIX; no-op on Windows (NTFS uses
 * ACLs, not POSIX mode bits). Swallows errors with WARN so a
 * permissions failure never blocks the CLI.
 */
export function setCacheDirPermissions(cacheDir: string): void {
  if (process.platform === 'win32') return;
  try {
    chmodSync(cacheDir, 0o700);
  } catch {
    /* best-effort */
  }
}

function asSha(value: string): string {
  return /^[0-9a-f]{40}$/.test(value) ? value : value;
}

// Cross-module glue: private inside ecc-cache-service.ts before the split.
export {
  asSha,
  ECC_CACHE_VERSION,
  ECC_MATERIALIZE_VERSION,
  ECC_TARBALL_BASENAME,
  GITHUB_API_ACCEPT
};
