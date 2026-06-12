/**
 * Backing detector — classifies each red line as `cli-backed`, `partial`,
 * or `prose-only`. The classifier already sets the backing for catalog hits
 * (cli-backed when an enforcer file path is present). This module exists to
 * handle the post-classification nuance: heuristics for the "partial" tier
 * (a gate exists but the LLM can bypass it) and verification that the
 * enforcer file actually exists on disk.
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

export interface BackingResult {
  readonly entry: RedLineEntry;
  readonly enforcerExists: boolean;
}

/**
 * Re-classify a single RedLineEntry. Returns a new entry with the
 * `backing` field updated and `enforcerRef` possibly nulled if the
 * referenced file does not exist on disk.
 */
export function classifyBacking(
  entry: RedLineEntry,
  projectRoot: string,
): BackingResult {
  if (detectPartial(entry.source.context)) {
    return {
      entry: { ...entry, backing: 'partial' },
      enforcerExists: entry.enforcerRef !== null && existsSync(resolve(projectRoot, entry.enforcerRef)),
    };
  }

  if (entry.enforcerRef === null) {
    return { entry, enforcerExists: false };
  }

  const enforcerPath = resolve(projectRoot, entry.enforcerRef);
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
): BackingBatchResult {
  const updated: RedLineEntry[] = [];
  const warnings: string[] = [];
  for (const entry of entries) {
    const { entry: reclassified, enforcerExists } = classifyBacking(entry, projectRoot);
    updated.push(reclassified);
    if (reclassified.backing === 'cli-backed' && !enforcerExists) {
      // Defensive: should not happen because classifyBacking downgrades to
      // prose-only, but keep the assertion in case of future drift.
      warnings.push(`enforcer ref "${reclassified.enforcerRef}" missing on disk for ${reclassified.id}`);
    }
  }
  return { entries: updated, warnings };
}
