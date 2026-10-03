/**
 * Readers for the plugin-free materialized ECC agents.
 *
 * Split verbatim out of `ecc-cache-service.ts` (wave 11 slice A,
 * 2026-10-03); no behaviour changed. The section banner below is the
 * original in-file divider of the materialize layer, kept verbatim.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  resolveEccMaterializedDir,
  resolveEccMaterializedManifestPath,
  type EccMaterializeManifest
} from './ecc-cache-config.js';
import { isSafeAgentName } from './ecc-archive-safety.js';

// ---------------------------------------------------------------------
// Plugin-free materialize layer (Slice A of 2026-09-09-ecc-dynamic)
//
// `peaks ecc install` downloads ECC `agents/*.md` into the sha cache, but
// that path is plugin-independent only in storage — the RD fan-out still
// needed `Agent({subagent_type: 'everything-claude-code:code-review'})` (old retired id),
// which requires the ECC Claude Code plugin. Materializing a normalized
// copy under `~/.peaks/agents/ecc/` gives the RD loop a plugin-free read
// target so a fresh machine without the ECC plugin can still run the
// review via a generic sub-agent.
// ---------------------------------------------------------------------

export function readEccMaterializeManifest(dirOverride?: string): EccMaterializeManifest | null {
  const path = resolveEccMaterializedManifestPath(dirOverride);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as EccMaterializeManifest;
    if (
      typeof parsed.version === 'string' &&
      typeof parsed.sha === 'string' &&
      typeof parsed.materializedAt === 'string' &&
      Array.isArray(parsed.agents)
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function listMaterializedAgents(dirOverride?: string): string[] {
  const dir = dirOverride ?? resolveEccMaterializedDir();
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/i, ''))
      .filter((name) => isSafeAgentName(name))
      .sort();
  } catch {
    return [];
  }
}

export function hasMaterializedEccAgents(dirOverride?: string): boolean {
  return listMaterializedAgents(dirOverride).length > 0;
}

/**
 * Resolve the materialized ECC agent name for a logical role.
 *
 * Upstream ECC names its agents `<lang>-reviewer` (`code-reviewer.md`),
 * NOT `code-review.md` — so no caller may hardcode a single filename.
 * Resolution order (deterministic; `listMaterializedAgents` is sorted):
 *   1. the caller's explicit candidates, in declared priority order
 *      (e.g. `['code-reviewer', 'code-review']` — real upstream name
 *      first, legacy/forward-compat second);
 *   2. a fallback over the materialized list: the exact
 *      `<stem>-reviewer`, else the first `<stem>-*` whose name contains
 *      `reviewer`, where `stem` is the candidate minus a `-reviewer`
 *      suffix (`code-reviewer` -> `code`).
 *
 * Returns `null` when nothing matches — the caller degrades to inline
 * review instead of dispatching a non-existent agent.
 */
export function resolveMaterializedAgentName(
  candidates: readonly string[],
  dirOverride?: string
): string | null {
  const available = listMaterializedAgents(dirOverride);
  if (available.length === 0) return null;

  for (const candidate of candidates) {
    if (available.includes(candidate)) return candidate;
  }

  for (const candidate of candidates) {
    const stem = candidate.replace(/-reviewer$/, '');
    const exact = available.find((name) => name === `${stem}-reviewer`);
    if (exact !== undefined) return exact;
    const reviewerish = available.find(
      (name) => name.startsWith(`${stem}-`) && name.includes('reviewer')
    );
    if (reviewerish !== undefined) return reviewerish;
  }

  return null;
}

export function readMaterializedAgent(name: string, dirOverride?: string): string | null {
  if (!isSafeAgentName(name)) return null;
  const file = join(dirOverride ?? resolveEccMaterializedDir(), `${name}.md`);
  if (!existsSync(file)) return null;
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
