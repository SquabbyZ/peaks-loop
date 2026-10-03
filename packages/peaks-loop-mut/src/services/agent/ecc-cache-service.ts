/**
 * ECC cache service — Slice 3 of 4.0.0-beta.11.
 *
 * Drop-in replacement for the deleted `ecc-agent-service.ts`. The
 * pre-Slice-3 implementation shelled out to `npx ecc agent run ...`,
 * but the upstream `affaan-m/everything-claude-code` v2.0.0 release
 * has NO `ecc` binary — the repo is `agents/*.md` flat files plus
 * SKILL.md descriptors. The peaks-loop path is therefore download
 * + cache only; the LLM consumes cached `agents/*.md` directly
 * through `peaks ecc show <name>`.
 *
 * Six cache exports per RD §2:
 *   - setCacheDirPermissions
 *   - downloadToCache
 *   - readCacheManifest
 *   - listCachedAgents
 *   - readAgentSkill
 *   - cleanupStaleCache
 *
 * Slice A of 2026-09-09-ecc-dynamic adds the plugin-free materialize
 * layer (`materializeEccAgents` + readers) that copies the active sha's
 * `agents/*.md` into `~/.peaks/agents/ecc/` so the RD fan-out works on a
 * machine with no ECC Claude Code plugin.
 *
 * The cache layout is `~/.peaks/cache/ecc-installed.json` (manifest)
 * + `~/.peaks/cache/ecc-<sha>/agents/<name>.md`. The manifest is
 * the active-cache pointer; cleanupStaleCache iterates the on-disk
 * sha directories and decides based on the manifest's `fetchedAt`
 * (active) vs `mtimeMs` (orphan).
 *
 * Hard contracts (Karpathy #2 Simplicity First):
 *  - No subprocess plumbing. Network is `fetch()` only.
 *  - No factory; one module, six functions, six dependencies.
 *  - Strict selective extract: agents/*.md only, no symlinks, no
 *    `..`, no absolute paths, no devices.
 *  - D-009 fallback: parseFrontmatter throws on malformed input —
 *    wrap it in try/catch and synthesize `{name, description}`
 *    from the file name + first non-empty body line.
 *  - D-010 fallback order (2026-09-09, leads with what actually works):
 *      1. `tarball_url` from `releases/tags/<ref>` — the only path that
 *         serves a tarball on upstream v2.2.0. Must be fetched with
 *         `accept: application/vnd.github+json`; GitHub's API tarball
 *         endpoint answers 415 to `application/octet-stream`.
 *      2. release asset named `ecc.tar.gz` or any `.tgz` / `.tar.gz`.
 *      3. PRD's `ecc.tar.gz` asset URL — dead today (v2.2.0 ships only
 *         `.png` assets) but kept as last resort in case a future
 *         release ships the asset again.
 */

// ---------------------------------------------------------------------
// 2026-10-03 wave 11 slice A: this file is the facade for the split. The
// implementation lives in the sibling modules beside it; this module keeps
// the download orchestration plus the FULL original export surface, because
// `tests/unit/services/ecc/*` import this exact path after mocking
// `node:os` (T2) and `src/index.ts` re-exports it. Do not move these files
// without reading `.peaks/docs/lint-gate.md` §4e/§4r first.
// ---------------------------------------------------------------------

import { existsSync, mkdirSync, readdirSync } from 'node:fs';

import {
  ECC_CACHE_VERSION,
  ECC_REPO_OWNER,
  ECC_REPO_NAME,
  resolveEccCacheDir,
  resolveAgentsDir,
  setCacheDirPermissions,
  asSha,
  type CacheManifest,
  type DownloadResult
} from './ecc-cache-config.js';
import { fetchReleaseJson, resolveCommitSha, downloadTarball } from './ecc-fetch.js';
import { writeManifest } from './ecc-cache-manifest.js';
import { materializeBestEffort } from './ecc-materialize.js';

/**
 * Download ECC into `~/.peaks/cache/ecc-<sha>/agents/`. Returns
 * the resolved SHA + the number of agents extracted.
 *
 * Throws `Error('fetch-failed')` on network failure so the CLI
 * layer can render the manual-install instructions.
 */
export async function downloadToCache({ ref }: { ref?: string } = {}): Promise<DownloadResult> {
  const requestedRef = ref ?? 'latest';
  let resolvedSha: string;
  if (requestedRef === 'latest') {
    const release = await fetchReleaseJson(
      `https://api.github.com/repos/${ECC_REPO_OWNER}/${ECC_REPO_NAME}/releases/latest`
    );
    const tag = release?.tag_name;
    if (typeof tag !== 'string' || tag.length === 0) {
      throw new Error('fetch-failed');
    }
    resolvedSha = asSha((await resolveCommitSha(tag)) ?? tag);
  } else {
    resolvedSha = asSha((await resolveCommitSha(requestedRef)) ?? requestedRef);
  }

  const cacheDir = resolveEccCacheDir();
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
  setCacheDirPermissions(cacheDir);

  const agentsDir = resolveAgentsDir(resolvedSha, cacheDir);
  if (existsSync(agentsDir) && readdirSync(agentsDir).length > 0) {
    // Already populated; emit manifest + return.
    const agents = readdirSync(agentsDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/i, ''));
    writeManifest({
      version: ECC_CACHE_VERSION,
      sha: resolvedSha,
      fetchedAt: new Date().toISOString(),
      agents
    });
    materializeBestEffort(cacheDir);
    return { sha: resolvedSha, agents: agents.length };
  }

  const extracted = await downloadTarball(
    requestedRef === 'latest' ? resolvedSha : requestedRef,
    resolvedSha,
    agentsDir
  );
  const manifest: CacheManifest = {
    version: ECC_CACHE_VERSION,
    sha: resolvedSha,
    fetchedAt: new Date().toISOString(),
    agents: extracted
  };
  writeManifest(manifest);
  materializeBestEffort(cacheDir);
  return { sha: resolvedSha, agents: extracted.length };
}

// Re-exports — the exact public surface of the pre-split module.
export {
  ECC_REPO_OWNER,
  ECC_REPO_NAME,
  type CacheManifest,
  type DownloadResult,
  type EccMaterializeManifest,
  resolveEccCacheDir,
  resolveManifestPath,
  resolveShaDir,
  resolveAgentsDir,
  resolveEccMaterializedDir,
  resolveEccMaterializedManifestPath,
  setCacheDirPermissions
} from './ecc-cache-config.js';

export { readCacheManifest, listCachedAgents, readAgentSkill } from './ecc-cache-manifest.js';

export {
  readEccMaterializeManifest,
  listMaterializedAgents,
  hasMaterializedEccAgents,
  resolveMaterializedAgentName,
  readMaterializedAgent
} from './ecc-materialized-readers.js';

export { materializeEccAgents } from './ecc-materialize.js';

export { cleanupStaleCache } from './ecc-cache-cleanup.js';
