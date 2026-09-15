/**
 * Backing detector — classifies each red line as `cli-backed`, `partial`,
 * or `prose-only`. The classifier already sets the backing for catalog hits
 * (cli-backed when an enforcer file path is present). This module exists to
 * handle the post-classification nuances: heuristics for the "partial" tier
 * (a gate exists but the LLM can bypass it), verification that the enforcer
 * file exists on disk, and — since A9 of the 2026-09-15 diagnosis —
 * verification that the enforcer is actually reachable from a call site.
 *
 * `cli-backed` means "a CLI surface runs this rule". A file that exists but
 * that nothing imports runs nothing, so it is `prose-only` with the same
 * weight as an unwritten rule. Callers pass the live set from
 * `enforcer-liveness.ts`; `null` means "liveness undecidable for this
 * project" (no `src/` tree), in which case the existing file is trusted.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RedLineBacking, RedLineEntry } from './types.js';

const PARTIAL_PHRASES = [
  'if llm cooperates',
  'llm-cooperation',
  'partial cli backing',
  'best effort',
  'advisory only',
  'soft enforcement',
  'when remembered',
] as const;

function detectPartial(context: string): boolean {
  const lower = context.toLowerCase();
  return PARTIAL_PHRASES.some((phrase) => lower.includes(phrase));
}

/**
 * `liveEnforcers` is the set of enforcerRefs with a call site (see
 * `enforcer-liveness.ts`), or `null` when the project has no `src/` tree to
 * scan and liveness therefore cannot be decided.
 */
export type LiveEnforcerSet = ReadonlySet<string> | null;

export interface BackingResult {
  readonly entry: RedLineEntry;
  readonly enforcerExists: boolean;
  /** True when the enforcer file exists but no call site imports it. */
  readonly enforcerDead: boolean;
}

/**
 * Re-classify a single RedLineEntry. Returns a new entry with the
 * `backing` field updated; `enforcerRef` is preserved even when the
 * backing is downgraded, because the dead reference is the triage
 * information the report needs.
 */
export function classifyBacking(
  entry: RedLineEntry,
  projectRoot: string,
  liveEnforcers: LiveEnforcerSet,
): BackingResult {
  const enforcerPath =
    entry.enforcerRef === null ? null : resolve(projectRoot, entry.enforcerRef);
  const exists = enforcerPath !== null && existsSync(enforcerPath);
  const dead =
    entry.enforcerRef !== null && exists && liveEnforcers !== null && !liveEnforcers.has(entry.enforcerRef);

  if (detectPartial(entry.source.context)) {
    return {
      entry: { ...entry, backing: 'partial' },
      enforcerExists: exists,
      enforcerDead: dead,
    };
  }

  if (entry.enforcerRef === null) {
    return { entry, enforcerExists: false, enforcerDead: false };
  }

  const backed = exists && !dead;
  return {
    entry: { ...entry, backing: backed ? 'cli-backed' : 'prose-only' },
    enforcerExists: exists,
    enforcerDead: dead,
  };
}

export interface BackingBatchResult {
  readonly entries: readonly RedLineEntry[];
  readonly warnings: readonly string[];
  /** Sorted, deduplicated enforcerRefs downgraded for having no call site. */
  readonly deadEnforcers: readonly string[];
}

export function classifyBackingBatch(
  entries: readonly RedLineEntry[],
  projectRoot: string,
  liveEnforcers: LiveEnforcerSet,
): BackingBatchResult {
  const updated: RedLineEntry[] = [];
  const warnings: string[] = [];
  const dead = new Set<string>();
  for (const entry of entries) {
    const result = classifyBacking(entry, projectRoot, liveEnforcers);
    updated.push(result.entry);
    if (result.enforcerDead && result.entry.enforcerRef !== null) {
      dead.add(result.entry.enforcerRef);
    }
    if (result.entry.backing === 'cli-backed' && !result.enforcerExists) {
      // Defensive: should not happen because classifyBacking downgrades to
      // prose-only, but keep the assertion in case of future drift.
      warnings.push(`enforcer ref "${result.entry.enforcerRef}" missing on disk for ${result.entry.id}`);
    }
  }
  return { entries: updated, warnings, deadEnforcers: [...dead].sort() };
}
