/**
 * Slice Pick Service — thin wrapper around the generic fzf picker.
 *
 * v2 (slice 2026-06-14-fzf-headroom-rollout): the actual fzf
 * integration is now in `src/services/fuzzy-matching/fzf-pick-service.ts`.
 * This file only knows how to format / parse SliceCandidate rows and
 * pick the output path. The algorithm itself (slice-decompose-service)
 * is fzf-free; fzf is the *consumer* of the algorithm output, not an
 * input to it. v3 can swap fzf for a different selector (skim, peco)
 * by replacing this file — the algorithm is unaffected.
 */

import { join } from 'node:path';
import { pickFromList, type FzfPickResult } from '../fuzzy-matching/fzf-pick-service.js';
import type { DecompositionResult, SliceCandidate } from './slice-decompose-types.js';

export interface PickOptions {
  /** When true, render side-by-side preview in fzf (recommended; needs fzf >= 0.38). */
  preview?: boolean;
  /** Override fzf binary path (default: 'fzf'). Useful for tests. */
  fzfBin?: string;
  /** Override stdin content for tests; bypasses the actual spawning. */
  overrideStdin?: string;
}

export interface PickedResult {
  picked: readonly SliceCandidate[];
  outputPath: string;
  fzfVersion: string;
}

/**
 * Parse one formatted fzf output line into its slice rid. The
 * formatter writes `B<batch> | <rid> | <label> | <minutesP50>m | <fileList>`,
 * so the rid is the second `|`-delimited field.
 */
function parseSliceLine(line: string): { rid: string } | null {
  const parts = line.split('|').map((p) => p.trim());
  if (parts.length < 2) return null;
  const rid = parts[1];
  if (rid === undefined || rid.length === 0) return null;
  return { rid };
}

export async function pickSlicesInteractive(
  rid: string,
  decomposition: DecompositionResult,
  projectRoot: string,
  options: PickOptions = {}
): Promise<PickedResult> {
  // Flatten candidates from all batches (preserves fzf line order).
  const candidates: Array<{ batch: number; slice: SliceCandidate }> = [];
  for (const batch of decomposition.parallelBatches) {
    for (const slice of batch.slices) {
      candidates.push({ batch: batch.batch, slice });
    }
  }

  // Map rid → candidate for O(1) parse lookups instead of O(n) scan per line.
  const byRid = new Map<string, { batch: number; slice: SliceCandidate }>();
  for (const c of candidates) {
    byRid.set(c.slice.rid, c);
  }

  const formatLine = ({ batch, slice }: { batch: number; slice: SliceCandidate }): string => {
    const fileList = slice.files.join(',');
    return `B${batch} | ${slice.rid} | ${slice.label} | ${slice.estimate.minutesP50}m | ${fileList}`;
  };

  const outputPath = join(projectRoot, '.peaks', 'sc', 'slice-decomposition', `${rid}-picked.json`);

  const result: FzfPickResult<{ batch: number; slice: SliceCandidate }> = await pickFromList({
    items: candidates,
    formatLine,
    parseLine: (line) => {
      const parsed = parseSliceLine(line);
      if (parsed === null) return null;
      const candidate = byRid.get(parsed.rid);
      return candidate ?? null;
    },
    outputPath,
    meta: { rid, parentRid: decomposition.rid },
    ...(options.preview !== undefined ? { preview: options.preview } : {}),
    ...(options.fzfBin !== undefined ? { fzfBin: options.fzfBin } : {}),
    ...(options.overrideStdin !== undefined ? { overrideStdin: options.overrideStdin } : {}),
    projectRoot,
    multi: true,
    prompt: 'slice> '
  });

  return {
    picked: result.picked.map((c) => c.slice),
    outputPath: result.outputPath,
    fzfVersion: result.fzfVersion
  };
}

/**
 * Re-export the fzf pick-service primitives for callers that want to
 * build their own pickers without depending on the slice namespace.
 */
export { pickFromList } from '../fuzzy-matching/fzf-pick-service.js';
export type { FzfPickOptions, FzfPickResult } from '../fuzzy-matching/fzf-pick-service.js';
