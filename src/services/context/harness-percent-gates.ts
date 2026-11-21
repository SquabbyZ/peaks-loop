/**
 * Harness auto-compact THRESHOLD percent — THE GATES, in order.
 *
 * Split out of `harness-compact-threshold-config.ts` so the writer stays under
 * the file-size cap and so the order of the gates can be read (and tested) on
 * its own. `syncHarnessPercent` is the only caller.
 *
 * Order is load-bearing and is the window writer's: opt-out and the home guard
 * first (they are about WHERE), then "no value asked for", then the band (an
 * out-of-band request is refused whatever the file holds), then the file's
 * editability, then idempotence, then provenance last — so `unchanged` is
 * reported for a human's own matching value rather than a refusal.
 */

import { isUserHomeProjectRoot } from '../config/config-safety.js';
import {
  isEditableSettingsFile,
  isLinkedSettingsFile,
  settingsEnvValue,
  type SettingsFileShape
} from './harness-settings-file.js';
import {
  HARNESS_WINDOW_SYNC_OPTOUT_KEY,
  HARNESS_WINDOW_SYNC_OPTOUT_VALUE
} from './harness-window-config.js';
import { parseHarnessCompactPercent } from './harness-percent-ownership.js';
import type { HarnessCompactThresholdLocation } from './harness-compact-threshold-config.js';

/**
 * The sentinel `percentSkipReason` returns for "the file already holds the
 * wanted value" — a non-reason, so the action enum stays `written | unchanged |
 * skipped` and the caller has one branch per outcome.
 */
export const SKIP_UNCHANGED = '__unchanged__';

/** Everything the gates are allowed to see. */
export interface PercentGateInput {
  readonly location: HarnessCompactThresholdLocation;
  readonly percent: number | null;
  readonly settings: SettingsFileShape | null;
  readonly fileRaw: unknown;
  readonly filePercent: number | null;
  readonly peakWritten: boolean;
}

/**
 * THE GATES: the reason this call must not write, `SKIP_UNCHANGED` when the
 * file already holds the wanted value, or `null` when it may write.
 */
export function percentSkipReason(input: PercentGateInput): string | null {
  const where = placementRefusal(input);
  if (where !== null) return where;
  if (input.percent === null) return noValueRefusal(input);
  if (parseHarnessCompactPercent(input.percent) === null) return 'out-of-range';
  // THE LINK GUARD, before `unreadable-settings`. A symlinked `settings.local.json`
  // — or a symlinked `.claude` directory holding an ordinary one — parses fine, so
  // the editability test would say "editable" and the write would follow the link
  // into whatever it points at. Its own reason — not
  // `unreadable-settings` — because the file IS readable; the problem is where a
  // write would land, and the user needs to be told that, not that their JSON is
  // broken. See `isLinkedSettingsFile`.
  if (isLinkedSettingsFile(input.location.settingsPath)) return 'symlinked-settings';
  if (!isEditableSettingsFile(input.location.settingsPath)) return 'unreadable-settings';
  if (input.filePercent === input.percent) return SKIP_UNCHANGED;
  // The same provenance rule as the window, decided from the FILE against its
  // own marker: peaks-loop may update what it wrote and fill an empty slot, and
  // never touches a value it did not write.
  if (input.fileRaw !== undefined && !input.peakWritten) return 'not-peaks-owned';
  return null;
}

/**
 * The caller asked for no percent: why, from what the FILE holds.
 *
 * A value on disk that is not a percentage at all (`eighty`, `80.5`) is its own
 * state: the caller has no number to offer because the FILE's value did not
 * parse, which is not the same fact as "the caller asked for no percent" — that
 * one reads `no-percent-resolved` and describes an empty slot.
 *
 * A whole NUMBER outside the band (`150`) is a third state: it parses, so it IS
 * a percentage the harness will not accept. Reporting it as
 * `unreadable-percent` told the user their value was not a percentage, which is
 * false and points at the wrong remedy.
 */
function noValueRefusal(input: PercentGateInput): string {
  if (input.fileRaw === undefined || input.filePercent !== null) return 'no-percent-resolved';
  return isWholeNumber(input.fileRaw) ? 'out-of-range' : 'unreadable-percent';
}

/**
 * THE SAME SPELLING RULE THE PARSER USES — digits with no leading zero beyond a
 * lone `0`. `Number('80.0')`, `Number('+80')` and `Number('00080')` all succeed,
 * so a bare "is it a finite whole number" test called a float or a signed
 * spelling a whole number outside the band, and the notice told the user their
 * `80.0` was "outside the 1..100 percent" when it was not a number at all.
 */
const PLAIN_WHOLE_SPELLING = /^(?:0|[1-9]\d*)$/;

/** One raw value is the plain whole-number spelling this module writes. */
function isWholeNumber(raw: unknown): boolean {
  if (typeof raw === 'number') return Number.isInteger(raw);
  if (typeof raw !== 'string') return false;
  return PLAIN_WHOLE_SPELLING.test(raw.trim());
}

/**
 * The two WHERE gates, checked before anything about the value. Split out only
 * to keep each function under the complexity ceiling — the order of the whole
 * gate sequence is documented on `percentSkipReason`.
 */
function placementRefusal(input: {
  readonly location: HarnessCompactThresholdLocation;
  readonly settings: SettingsFileShape | null;
}): string | null {
  if (
    settingsEnvValue(input.settings, HARNESS_WINDOW_SYNC_OPTOUT_KEY) ===
    HARNESS_WINDOW_SYNC_OPTOUT_VALUE
  )
    return 'opted-out';
  if (input.location.projectRoot !== undefined && isUserHomeProjectRoot(input.location.projectRoot))
    return 'unsafe-project-root';
  return null;
}
