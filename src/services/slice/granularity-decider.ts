/**
 * GranularityDecider — pure function used by MultiPassOrchestrator to
 * decide whether a WorkUnit should be subdivided further.
 *
 * No LLM dependency. Output is one of three branches:
 *   - { subdivide: true }          — clearly over threshold, split now
 *   - { subdivide: 'tie-break' }   — within 20% of threshold, defer to LLMArbitrator
 *   - { subdivide: false }         — under threshold, stop subdividing
 *
 * The "tie-break" branch exists because large files (>80% of threshold)
 * sometimes read like one cohesive unit; the orchestrator calls
 * LLMArbitrator (which has project context) for that call.
 */

import type { WorkUnit } from './slice-decompose-types.js';

export interface GranularityThresholds {
  readonly maxFiles: number;
  readonly maxLoc: number;
}

export type DeciderResult =
  | { readonly subdivide: true; readonly reason: string }
  | { readonly subdivide: false; readonly reason: string }
  | { readonly subdivide: 'tie-break'; readonly reason: string };

export const DEFAULT_THRESHOLDS: GranularityThresholds = { maxFiles: 3, maxLoc: 400 };

/**
 * Decide whether `wu` should be subdivided.
 *
 * Boundary semantics: `>` (strict). At the exact threshold (loc === maxLoc,
 * files.length === maxFiles) the result is `subdivide: false`. This matches
 * the spec: "threshold is exclusive; we only subdivide what is OVER it."
 */
export function shouldSubdivide(
  wu: WorkUnit,
  thresholds: GranularityThresholds = DEFAULT_THRESHOLDS
): DeciderResult {
  const locExceeded = wu.loc > thresholds.maxLoc;
  const filesExceeded = wu.files.length > thresholds.maxFiles;
  if (locExceeded || filesExceeded) {
    return {
      subdivide: true,
      reason: `wu ${wu.id}: loc=${wu.loc} files=${wu.files.length} exceeds threshold`,
    };
  }
  const locBorderline = wu.loc > thresholds.maxLoc * 0.8;
  const filesBorderline = wu.files.length > thresholds.maxFiles * 0.8;
  if (locBorderline || filesBorderline) {
    return {
      subdivide: 'tie-break',
      reason: `wu ${wu.id}: within 20% of threshold, needs LLM judgment`,
    };
  }
  return { subdivide: false, reason: `wu ${wu.id}: under threshold` };
}