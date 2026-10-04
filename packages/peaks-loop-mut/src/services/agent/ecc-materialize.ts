/**
 * The materialize write path — copy `ecc-universal`'s `agents/*.md` into the
 * peaks-owned stable dir the LLM reads, and prune what upstream no longer
 * ships.
 *
 * The source used to be `~/.peaks/cache/ecc-<sha>/agents/`, populated by a
 * network download; it is now the installed package directory (see
 * `ecc-package-source.ts` for why). The target, the per-file failure policy,
 * and the prune step are unchanged: the dir is a read contract for the RD
 * fan-out and for `~/.peaks/agents/ecc/<name>.md` in the skill docs, so a stale
 * copy is a wrong answer rather than an untidy one.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ECC_MATERIALIZE_VERSION,
  isSafeAgentName,
  readEccPackageVersion,
  resolveEccAgentsDir,
  resolveEccMaterializedDir,
  resolveEccMaterializedManifestPath,
  setPeaksDirPermissions,
  type EccInstallResult,
  type EccMaterializeManifest
} from './ecc-package-source.js';

/**
 * Refresh the plugin-free copy from the package.
 *
 * `targetDir` is the ONLY write root (plus `mkdirSync` on it). Nothing in this
 * function can reach `~/.claude/`.
 *
 * Fail-soft by policy, and the policy is per file: a single unreadable agent
 * skips that agent and the rest land, because a partial review roster is useful
 * while an exception here would stop `peaks ecc install` for a reason the user
 * cannot act on. What is NOT swallowed is the absence of the package itself —
 * `resolveEccAgentsDir` throws `EccSourceError` and the caller renders the
 * reinstall instruction, because "ECC is not installed" pretending to be "ECC
 * installed 0 agents" is the failure mode this whole layer was built to avoid.
 */
export function materializeEccAgents({
  sourceDir,
  targetDir
}: { sourceDir?: string; targetDir?: string } = {}): EccInstallResult {
  const agentsDir = sourceDir ?? resolveEccAgentsDir();
  const resolvedTarget = targetDir ?? resolveEccMaterializedDir();
  const entries = readdirSync(agentsDir);

  if (!existsSync(resolvedTarget)) mkdirSync(resolvedTarget, { recursive: true });
  setPeaksDirPermissions(resolvedTarget);

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

  // Prune stale copies so `readMaterializedAgent` cannot serve an agent this
  // package version no longer ships.
  for (const existing of readdirSync(resolvedTarget)) {
    if (!existing.endsWith('.md')) continue;
    const name = existing.replace(/\.md$/i, '');
    if (!materialized.includes(name)) {
      rmSync(join(resolvedTarget, existing), { force: true });
    }
  }

  const manifest: EccMaterializeManifest = {
    version: ECC_MATERIALIZE_VERSION,
    packageVersion: readEccPackageVersion(),
    materializedAt: new Date().toISOString(),
    agents: materialized
  };
  writeFileSync(
    resolveEccMaterializedManifestPath(resolvedTarget),
    JSON.stringify(manifest, null, 2)
  );

  return {
    targetDir: resolvedTarget,
    packageVersion: manifest.packageVersion,
    materialized
  };
}
