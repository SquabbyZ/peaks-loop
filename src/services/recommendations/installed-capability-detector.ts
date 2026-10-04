/**
 * Read-only "is this capability already satisfied on this machine?"
 * detector for the capability catalog (`peaks capability status` /
 * `peaks capabilities --source ...`).
 *
 * Slice B1 of 2026-09-09-ecc-dynamic-and-cleanup: the previous
 * `getInstalledCapabilityIds()` returned `[]` unconditionally, so the
 * catalog could never report anything as installed. This module answers
 * the question from evidence that already exists on disk — no install
 * side effect, no network, no subprocess:
 *
 *   - `everything-claude-code.*` — satisfied when the ECC agents are readable,
 *     i.e. `~/.peaks/agents/ecc/` holds at least one agent (landed by
 *     `peaks ecc install` from the `ecc-universal` dependency).
 *   - a source that maps to an npm package — satisfied when that package
 *     (or its `.bin` shim) is present in the project's `node_modules`.
 *
 * Every probe is fail-soft: a throw degrades to "not installed" so the
 * catalog never breaks because a probe failed.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { hasMaterializedEccAgents } from 'peaks-loop-mut';

import { seedCapabilityItems } from './capability-seed-items.js';

const ECC_SOURCE_ID = 'everything-claude-code';

/**
 * `sourceId` → npm package whose presence in `node_modules` satisfies the
 * item's acquisition. Deliberately explicit: the catalog mixes repos,
 * skills packages, MCP servers, and docs, and only a small subset is
 * actually an npm dependency we can probe. Adding an entry here is the
 * only change needed to make that source's items detectable.
 */
const NPM_PACKAGE_BY_SOURCE: Readonly<Record<string, string>> = {
  codegraph: 'codegraph'
};

export type InstalledCapabilityProbe = {
  /** Project whose `node_modules` is probed. */
  readonly projectRoot: string;
  /** Override for tests; defaults to `<projectRoot>/node_modules`. */
  readonly nodeModulesDir?: string;
  /** Override for tests; defaults to a live probe of the materialized copy. */
  readonly eccAgentsAvailable?: boolean;
};

function packagePresent(nodeModulesDir: string, packageName: string): boolean {
  try {
    return (
      existsSync(join(nodeModulesDir, packageName)) ||
      existsSync(join(nodeModulesDir, '.bin', packageName))
    );
  } catch {
    return false;
  }
}

function eccAgentsAvailable(): boolean {
  try {
    // The materialized copy is what the LLM can dispatch, so it is the only
    // evidence that counts. The cache probe this replaced
    // (`listCachedAgents()`, reading `~/.peaks/cache/ecc-<sha>/`) described
    // something downloaded but not necessarily usable.
    return hasMaterializedEccAgents();
  } catch {
    return false;
  }
}

/**
 * Return the capabilityIds whose acquisition is already satisfied.
 * Sorted + de-duplicated so the JSON envelope is stable across runs.
 */
export function detectInstalledCapabilityIds(probe: InstalledCapabilityProbe): string[] {
  const nodeModulesDir = probe.nodeModulesDir ?? join(probe.projectRoot, 'node_modules');
  const eccAvailable = probe.eccAgentsAvailable ?? eccAgentsAvailable();

  const installed = new Set<string>();
  for (const item of seedCapabilityItems) {
    if (item.sourceId === ECC_SOURCE_ID) {
      if (eccAvailable) installed.add(item.capabilityId);
      continue;
    }
    const packageName = NPM_PACKAGE_BY_SOURCE[item.sourceId];
    if (packageName !== undefined && packagePresent(nodeModulesDir, packageName)) {
      installed.add(item.capabilityId);
    }
  }

  return [...installed].sort();
}
