/**
 * Headroom preferences resolver (slice 2026-06-14-fzf-headroom-rollout).
 *
 * Pure functions that turn `ProjectPreferences.headroom.*` + CLI
 * overrides into a single decision the dispatch path can act on.
 * No IO. No side effects. Easy to test in isolation.
 *
 * Two distinct decisions:
 *  1. `resolveHeadroomOptions` — should we compress the dispatch prompt?
 *     Used by `peaks sub-agent dispatch`. Returns one of:
 *       - `{ mode: <m>, blocked: null }`   → compress with mode <m>
 *       - `{ mode: null, blocked: null }`  → skip compression (no --use-headroom)
 *       - `{ mode: null, blocked: 'HEADROOM_DISABLED_BY_PREFERENCE' }` → hard fail
 *  2. `shouldCompressResults` — should we compress search-result text?
 *     Used by `peaks memory search` / `peaks retrospective search`.
 *     Non-blocking: returns a `reason` instead of a `blocked` code.
 *
 * Precedence (dispatch):
 *   1. `headroom.enabled = false`  → hard block (regardless of --use-headroom)
 *   2. `headroom.enabled = true` + `--headroom-mode <m>` → use <m>
 *   3. `headroom.enabled = true` + `--use-headroom` (no --headroom-mode) →
 *      use `perTouchpoint.subAgentDispatch` (preferred) else `defaultMode`
 *   4. no `--use-headroom` → mode = null (compression skipped)
 */
import type { HeadroomMode, ProjectPreferences } from '../preferences/preferences-types.js';

export type HeadroomTouchpoint = keyof ProjectPreferences['headroom']['perTouchpoint'];

export type HeadroomBlockCode = 'HEADROOM_DISABLED_BY_PREFERENCE';

export interface ResolvedHeadroomOptions {
  /** The mode to use for compression, or null if not compressing. */
  readonly mode: HeadroomMode | null;
  /** Hard-block reason; null when compression is allowed (or simply not requested). */
  readonly blocked: HeadroomBlockCode | null;
}

export interface ResolveCliOverrides {
  readonly useHeadroom: boolean;
  readonly headroomMode?: string;
}

const VALID_MODES: ReadonlySet<HeadroomMode> = new Set<HeadroomMode>([
  'balanced',
  'aggressive',
  'conservative'
]);

export function isHeadroomMode(value: string | undefined): value is HeadroomMode {
  return typeof value === 'string' && VALID_MODES.has(value as HeadroomMode);
}

export function resolveHeadroomOptions(
  prefs: ProjectPreferences['headroom'],
  cliOverrides: ResolveCliOverrides
): ResolvedHeadroomOptions {
  // (1) Hard block when preference disables headroom entirely.
  if (cliOverrides.useHeadroom === true && prefs.enabled === false) {
    return { mode: null, blocked: 'HEADROOM_DISABLED_BY_PREFERENCE' };
  }

  // (4) No --use-headroom → no compression.
  if (cliOverrides.useHeadroom !== true) {
    return { mode: null, blocked: null };
  }

  // (2) CLI --headroom-mode wins (even if preference is set, CLI overrides).
  if (isHeadroomMode(cliOverrides.headroomMode)) {
    return { mode: cliOverrides.headroomMode, blocked: null };
  }

  // (3) Preference path: perTouchpoint > defaultMode > 'balanced'.
  const touchpointMode = prefs.perTouchpoint.subAgentDispatch;
  return { mode: touchpointMode ?? prefs.defaultMode, blocked: null };
}

export interface ShouldCompressDecision {
  readonly compress: boolean;
  readonly mode: HeadroomMode;
  /** Non-null reason if not compressing. */
  readonly reason: 'DISABLED' | 'BELOW_THRESHOLD' | null;
}

export function shouldCompressResults(
  prefs: ProjectPreferences['headroom'],
  joinedBytes: number,
  touchpoint: HeadroomTouchpoint
): ShouldCompressDecision {
  if (prefs.enabled === false) {
    return { compress: false, mode: prefs.defaultMode, reason: 'DISABLED' };
  }
  if (joinedBytes < prefs.compressMinBytes) {
    return { compress: false, mode: prefs.perTouchpoint[touchpoint], reason: 'BELOW_THRESHOLD' };
  }
  return { compress: true, mode: prefs.perTouchpoint[touchpoint], reason: null };
}
