/**
 * Backing detector — classifies each red line as `cli-backed`, `partial`,
 * or `prose-only`. The classifier already sets the backing for catalog hits
 * (cli-backed when an enforcer file path is present). This module exists to
 * handle the post-classification nuance: heuristics for the "partial" tier
 * (a gate exists but the LLM can bypass it) and verification that the
 * enforcer file actually exists on disk.
 *
 * Slice 4.0.7-dogfood-PR-1 (ice-cola surface probe 2026-08-02): the
 * `enforcerRef` paths in the catalog are written relative to the
 * peaks-loop source root (every `enforcerRef` is `src/services/audit/...`
 * and the catalog itself is at `src/services/audit/red-line-catalog.ts`).
 * Resolving them against the audited `--project` root produces false
 * orphans on every downstream project. Fix: resolve against the
 * peaks-loop install root by default, with an explicit
 * `peaksLoopRoot` override for tests.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

export interface BackingResult {
  readonly entry: RedLineEntry;
  readonly enforcerExists: boolean;
}

/**
 * Resolve the peaks-loop source root (where the catalog itself lives).
 * Walks upward from this very file until a `package.json` with
 * `name === 'peaks-loop'` is found. Cached after the first call.
 * Exported so tests can reset the cache between cases.
 */
let cachedPeaksLoopRoot: string | null = null;
export function resolvePeaksLoopRoot(): string {
  if (cachedPeaksLoopRoot !== null) return cachedPeaksLoopRoot;
  // This file lives at <root>/src/services/audit/backing-detector.ts.
  // Walk up to find peaks-loop's package.json.
  const here = dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(dir, 'package.json');
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: string };
        if (pkg.name === 'peaks-loop') {
          cachedPeaksLoopRoot = dir;
          return dir;
        }
      } catch {
        // malformed package.json; keep walking up
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: assume 4 levels up from this file (catalog + enforcers
  // share the same depth). Keeps the unit test that constructs a fake
  // projectRoot working when no real package.json is in the walk.
  cachedPeaksLoopRoot = resolve(here, '..', '..', '..', '..');
  return cachedPeaksLoopRoot;
}

/** Test-only: clear the cached peaks-loop root. */
export function _resetPeaksLoopRootCache(): void {
  cachedPeaksLoopRoot = null;
}

/**
 * Re-classify a single RedLineEntry. Returns a new entry with the
 * `backing` field updated and `enforcerRef` possibly nulled if the
 * referenced file does not exist on disk.
 *
 * `projectRoot` is the audited project (kept for callers that still
 * pass it for context, but no longer used to resolve `enforcerRef`).
 * `peaksLoopRoot` is the peaks-loop source root; defaults to
 * `resolvePeaksLoopRoot()`.
 */
export function classifyBacking(
  entry: RedLineEntry,
  projectRoot: string,
  peaksLoopRoot: string = resolvePeaksLoopRoot(),
): BackingResult {
  void projectRoot; // intentionally unused; preserved for API stability
  if (detectPartial(entry.source.context)) {
    return {
      entry: { ...entry, backing: 'partial' },
      enforcerExists: entry.enforcerRef !== null && existsSync(resolve(peaksLoopRoot, entry.enforcerRef)),
    };
  }

  if (entry.enforcerRef === null) {
    return { entry, enforcerExists: false };
  }

  const enforcerPath = resolve(peaksLoopRoot, entry.enforcerRef);
  const exists = existsSync(enforcerPath);
  return {
    entry: { ...entry, backing: exists ? 'cli-backed' : 'prose-only' },
    enforcerExists: exists,
  };
}

export interface BackingBatchResult {
  readonly entries: readonly RedLineEntry[];
  readonly warnings: readonly string[];
}

export function classifyBackingBatch(
  entries: readonly RedLineEntry[],
  projectRoot: string,
  peaksLoopRoot: string = resolvePeaksLoopRoot(),
): BackingBatchResult {
  const updated: RedLineEntry[] = [];
  const warnings: string[] = [];
  for (const entry of entries) {
    const { entry: reclassified, enforcerExists } = classifyBacking(entry, projectRoot, peaksLoopRoot);
    updated.push(reclassified);
    if (reclassified.backing === 'cli-backed' && !enforcerExists) {
      // Defensive: should not happen because classifyBacking downgrades to
      // prose-only, but keep the assertion in case of future drift.
      warnings.push(`enforcer ref "${reclassified.enforcerRef}" missing on disk for ${reclassified.id}`);
    }
  }
  return { entries: updated, warnings };
}
