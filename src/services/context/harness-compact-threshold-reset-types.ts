/**
 * The SHAPES a `peaks compact harness-window --reset` reports.
 *
 * WHY A FILE OF ITS OWN. `harness-compact-threshold-reset.ts` sat at the 300-raw-
 * line cap, and this interface plus its three companion types is the largest
 * block that can move out without carrying a copy of the rollback's logic: types
 * only, so a consumer of the result shape never pulls in the fs work.
 */

import type { HarnessPercentOwnership } from './harness-compact-threshold-config.js';
import type { HarnessWindowOwnership } from './harness-window-ownership.js';

/** Re-exported from the config module, where the five states are named. */
export type { HarnessPercentOwnership } from './harness-compact-threshold-config.js';
/** Re-exported from the window ownership module, where its five states are named. */
export type { HarnessWindowOwnership } from './harness-window-ownership.js';

/** What became of one knob. `absent` = nothing of peaks-loop's was there. */
export type HarnessThresholdResetKnobAction = 'removed' | 'kept-human' | 'absent';

/**
 * WHY the rollback wrote nothing, present only when it wrote nothing:
 * `unreadable-settings` (not a JSON object we can edit) or `symlinked-settings`
 * (a link, so a write would follow it into its target — its own reason, since
 * the file may parse perfectly and where the bytes LAND is the problem).
 */
export type HarnessThresholdResetRefusal = 'unreadable-settings' | 'symlinked-settings';

export interface HarnessThresholdResetResult {
  readonly settingsPath: string;
  readonly window: {
    readonly key: string;
    readonly action: HarnessThresholdResetKnobAction;
    /** Who the window value belonged to; drives `action`. */
    readonly ownership: HarnessWindowOwnership;
    readonly previousTokens: number | null;
    /**
     * A BOUNDED description of the file's value — never the raw string, not a
     * prefix of it (MED-2). `keptClause` renders this, so a secret mis-parked
     * at the key cannot reach stdout or a log. Present only when the key was.
     */
    readonly previousRawNote?: string;
  };
  readonly percent: {
    readonly key: string;
    readonly action: HarnessThresholdResetKnobAction;
    readonly ownership: HarnessPercentOwnership;
    readonly previousPercent: number | null;
    /** See `window.previousRawNote`. */
    readonly previousRawNote?: string;
  };
  /** True when the opt-out row is on disk after the call. */
  readonly optedOut: boolean;
  /**
   * True only when THIS call wrote the file. The sentence needs it: a stale
   * percent marker leaves both knobs `absent` (no value to name) while the
   * rollback still wrote, so the removals alone cannot tell that apart from a
   * genuine no-op — which is how the sentence came to say "nothing was written"
   * about a file that changed.
   */
  readonly wrote: boolean;
  /** Present only when the rollback declined to write; see `…Refusal`. */
  readonly refusal?: HarnessThresholdResetRefusal;
}
