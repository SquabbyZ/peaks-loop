/**
 * Harness auto-compact THRESHOLD — the REFUSAL sentences.
 *
 * Split out of `harness-compact-threshold-ensure.ts` so that file — which is at
 * the 300-raw-line cap — can keep the reconcile and its write announcements.
 * Every sentence here names a value, a file and a next step, because the bare
 * reason token (`(out-of-harness-range)`) names none of the three.
 *
 * THE REMEDY IS CHOSEN BY OWNERSHIP, NOT BY THE REASON. `--reset` removes only
 * what peaks-loop wrote (`percentOwnershipOf`); pointing it at a HUMAN value
 * would be advice the command refuses to carry out — measured: a no-marker
 * `150` was classified `human`, and `--reset` answered "Kept … your own
 * setting". A peaks-owned shape still gets the `--reset` advice, which is what
 * makes the documented recovery from a corrupted peaks write work; a human's
 * value gets the only remedy that exists for it — the user setting it.
 */

import {
  HARNESS_COMPACT_PERCENT_MAX,
  HARNESS_COMPACT_PERCENT_MIN
} from './harness-compact-threshold-config.js';
import { HARNESS_WINDOW_MAX_TOKENS, HARNESS_WINDOW_MIN_TOKENS } from './harness-window-config.js';
import type { HarnessCompactThresholdResult } from './harness-compact-threshold-ensure.js';

/** The band sentence, in one place, so no two notices can disagree about it. */
function percentBand(): string {
  return `${HARNESS_COMPACT_PERCENT_MIN}..${HARNESS_COMPACT_PERCENT_MAX}`;
}

/**
 * Why the percent half was not written, in words — one clause per `reason`.
 *
 * Every reason gets its own sentence rather than falling through to
 * `(${reason})`. The default clause is unreachable for the reasons this module
 * produces today; it exists so a future reason cannot silently degrade to a
 * token.
 *
 * `out-of-range` and `not-peaks-owned` each have TWO shapes, told apart by the
 * file's RAW value — see `describeFileValueRefusal`.
 */
export function describePercentRefusal(result: HarnessCompactThresholdResult): string {
  switch (result.percent.reason) {
    case 'opted-out':
      return 'Harness threshold not managed (opted-out) — `peaks compact harness-window --reenable` re-enables both knobs.';
    case 'unsafe-project-root':
      return `Harness threshold not managed: ${result.settingsPath} sits directly in the user's home directory rather than in a project, so it is the harness's settings for every project at once and peaks-loop left it alone. Run init from inside a project.`;
    case 'out-of-range':
    case 'unreadable-percent':
    case 'not-peaks-owned':
      return describeFileValueRefusal(result);
    case 'unreadable-settings':
      return `Harness threshold not managed: ${result.settingsPath} is not a JSON object peaks-loop can safely edit.`;
    case 'symlinked-settings':
      return `Harness threshold not managed: ${result.settingsPath} is a symlink (or a Windows junction), or the directory holding it is, so writing the percent would follow the link and overwrite the file it points at. Replace the link with a real file (or directory) and the percent lands here.`;
    default:
      return `Harness threshold not managed (${String(result.percent.reason)}).`;
  }
}

/**
 * The WINDOW refusal alone — the init warning's other half.
 *
 * A window can be refused while the percent writes or is unchanged (an
 * out-of-band `50000`, an opt-out that covers both, an unreadable file), and
 * the combined describer only mentions a window that WROTE. A caller routing a
 * refusal needs the window's own reason in words, for the same no-bare-token
 * reason the percent's has.
 */
export function describeWindowRefusal(result: HarnessCompactThresholdResult): string {
  const { window, settingsPath } = result;
  const band = `${HARNESS_WINDOW_MIN_TOKENS}..${HARNESS_WINDOW_MAX_TOKENS}`;
  switch (window.reason) {
    case 'opted-out':
      return 'the project opted out of harness management — `peaks compact harness-window --reenable` covers both knobs.';
    case 'unsafe-project-root':
      return `${settingsPath} sits directly in the user's home directory rather than in a project, so peaks-loop left it alone. Run init from inside a project.`;
    case 'no-window-resolved':
      return 'this call carried no token window, so peaks-loop did not invent one.';
    case 'out-of-harness-range':
      return `${window.key}: a window of ${String(window.requestedTokens)} is outside the ${band} band the harness accepts, so ${settingsPath} was not given a number it does not compact on.`;
    case 'not-peaks-owned':
      return `${window.key}: ${settingsPath} already carries a window peaks-loop did not write (${window.previousRawNote ?? 'a value'}), and peaks-loop never overwrites such a value.`;
    case 'symlinked-settings':
      return `${settingsPath} is a symlink (or a Windows junction), or the directory holding it is, so a write would follow the link and overwrite the file it points at.`;
    case 'unreadable-settings':
      return `${settingsPath} is not a JSON object peaks-loop can safely edit.`;
    default:
      return `the window was not managed (${String(window.reason)}).`;
  }
}

/**
 * The refusals decided by WHAT the file holds, in one place because they share
 * the sentence frame:
 *
 *   - `out-of-range` with a value on disk — a whole number outside 1..100. The
 *     old wording called `150` "not a percentage", which is false and points at
 *     the wrong remedy; it IS a percentage, just not one the harness accepts.
 *   - `out-of-range` with an empty slot — the caller's own number was out of band.
 *   - `unreadable-percent` — a typo (`eighty`), which is not a percentage at all.
 *   - `not-peaks-owned` — a human's pin, or a typo peaks-loop did not write.
 *
 * The FRAME is chosen by the value's shape; the REMEDY by who owns it. The two
 * are independent: `eighty` with no marker is both "not a percentage" and a
 * human's value, so it needs the human remedy inside the parse frame.
 */
function describeFileValueRefusal(result: HarnessCompactThresholdResult): string {
  const { percent, settingsPath } = result;
  const onDisk = percent.previousRawNote !== undefined;
  const quoted = `${settingsPath} carries ${percent.previousRawNote ?? 'a value'} as ${percent.key}`;
  const remedy = remedyClause(percent.ownership === 'human', result);
  if (percent.reason === 'out-of-range') {
    return !onDisk
      ? `Harness threshold not managed: ${String(percent.requestedPercent)} is outside the ${percentBand()} percent the harness accepts.`
      : `Harness threshold not managed: ${quoted}, which is outside the ${percentBand()} percent the harness accepts, so peaks-loop will not rewrite it. ${remedy}`;
  }
  if (percent.previousPercent !== null || !onDisk) {
    return `Harness threshold not managed: ${settingsPath} already carries a percent that peaks-loop did not write, and peaks-loop never overwrites such a value. ${remedy}`;
  }
  return `Harness threshold not managed: ${quoted}, which is not a percentage. ${remedy}`;
}

/**
 * The next step for a file-held percent, chosen by WHO owns it — see the module
 * header for why the two branches exist.
 */
function remedyClause(human: boolean, result: HarnessCompactThresholdResult): string {
  if (human) {
    return `This value is yours, not peaks-loop's, so peaks-loop leaves it for you to fix: set ${result.percent.key} to a whole number in the ${percentBand()} band in ${result.settingsPath}.`;
  }
  return `Set ${result.percent.key} to a whole number in the ${percentBand()} band, or \`peaks compact harness-window --reset\` to clear what peaks-loop wrote.`;
}
