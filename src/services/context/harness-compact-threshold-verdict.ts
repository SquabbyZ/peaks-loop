/**
 * Harness auto-compact THRESHOLD — the READ/VERDICT half.
 *
 * The harness reads `CLAUDE_CODE_AUTO_COMPACT_WINDOW` and
 * `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` (as declared by the active adapter) ONCE
 * at process start — measured 2026-11-20. So after peaks-loop writes the
 * project's settings file, the session already running keeps the old trigger,
 * and "the settings are configured" and "the settings are in force" are two
 * different facts. This module compares them and says so; it writes nothing.
 *
 * The write half (the percent sync, the defaults, the band) lives in
 * `harness-compact-threshold-config.ts`, which is also where
 * `HarnessCompactThresholdLocation` is declared — re-exported below so both
 * halves are reachable from this module, which is the import path the CLI uses.
 */

import {
  parseHarnessCompactPercent,
  readSettingsObject,
  settingsEnvValue,
  type HarnessCompactThresholdLocation
} from './harness-compact-threshold-config.js';
import { parseHarnessWindowTokens } from './harness-window-config.js';
import { boundedRawNote } from './harness-settings-file.js';

export type { HarnessCompactThresholdLocation };

/**
 * What one threshold read found, as BOUNDED notes rather than raw values.
 *
 * Each field is `boundedRawNote`'s fixed phrase, never the text the settings
 * file holds, and is present only when that side carried the key (MED-2). The
 * facts a reader needs survive: PRESENCE (is there a configuration on disk, and
 * did this session have one) and whether a value does not parse — not what it
 * said.
 */
export interface HarnessCompactThresholdRawValues {
  readonly windowRawNote?: string;
  readonly percentRawNote?: string;
  readonly envWindowRawNote?: string;
  readonly envPercentRawNote?: string;
}
/** One threshold read: the file's pair, the session's pair, and the verdict. */
export interface HarnessCompactThresholdReadResult {
  readonly settingsPath: string;
  readonly windowKey: string;
  readonly percentKey: string;
  readonly configured: {
    readonly windowTokens: number | null;
    readonly percent: number | null;
  };
  readonly inForce: {
    readonly windowTokens: number | null;
    readonly percent: number | null;
  };
  readonly matches: boolean;
  /** See `HarnessCompactThresholdRawValues`; absent means "no raw comparison". */
  readonly raw?: HarnessCompactThresholdRawValues;
}

function agrees(configured: number | null, fileRaw: unknown, inForce: number | null): boolean {
  if (fileRaw === undefined) return true;
  return configured !== null && configured === inForce;
}

/** Read both knobs, file vs process env, and say whether they agree. */
export function readHarnessCompactThreshold(input: {
  readonly location: HarnessCompactThresholdLocation;
  readonly env?: NodeJS.ProcessEnv | undefined;
}): HarnessCompactThresholdReadResult {
  const env = input.env ?? process.env;
  const settings = readSettingsObject(input.location.settingsPath);
  const windowRaw = settingsEnvValue(settings, input.location.envVar);
  const percentRaw = settingsEnvValue(settings, input.location.percentEnvVar);
  const envWindowRaw = env[input.location.envVar];
  const envPercentRaw = env[input.location.percentEnvVar];
  const configured = {
    windowTokens: parseHarnessWindowTokens(windowRaw),
    percent: parseHarnessCompactPercent(percentRaw)
  };
  const inForce = {
    windowTokens: parseHarnessWindowTokens(envWindowRaw),
    percent: parseHarnessCompactPercent(envPercentRaw)
  };
  return {
    settingsPath: input.location.settingsPath,
    windowKey: input.location.envVar,
    percentKey: input.location.percentEnvVar,
    configured,
    inForce,
    matches:
      agrees(configured.windowTokens, windowRaw, inForce.windowTokens) &&
      agrees(configured.percent, percentRaw, inForce.percent),
    // Each side is bounded HERE, at the source (MED-2): this result is folded
    // into envelope data that reaches logs. Presence survives as note presence.
    raw: {
      ...(windowRaw === undefined ? {} : { windowRawNote: boundedRawNote(windowRaw) }),
      ...(percentRaw === undefined ? {} : { percentRawNote: boundedRawNote(percentRaw) }),
      ...(envWindowRaw === undefined ? {} : { envWindowRawNote: boundedRawNote(envWindowRaw) }),
      ...(envPercentRaw === undefined ? {} : { envPercentRawNote: boundedRawNote(envPercentRaw) })
    }
  };
}

/**
 * The machine-readable verdict `peaks code context-now` puts on the envelope.
 *
 * Top-level `windowTokens`/`percent` are the CONFIGURED pair — the field
 * reports "what the project says" — and `inForce` is what this session uses,
 * so `matches` needs no second read. Built from parsed numbers, never from
 * raw strings.
 */
export interface HarnessThresholdVerdict {
  readonly windowTokens: number | null;
  readonly percent: number | null;
  readonly configured: HarnessCompactThresholdReadResult['configured'];
  readonly inForce: HarnessCompactThresholdReadResult['inForce'];
  readonly matches: boolean;
}

export function buildHarnessThresholdVerdict(
  read: HarnessCompactThresholdReadResult
): HarnessThresholdVerdict {
  return {
    windowTokens: read.configured.windowTokens,
    percent: read.configured.percent,
    configured: read.configured,
    inForce: read.inForce,
    matches: read.matches
  };
}

/**
 * One half of the pair, with the three states kept apart: a number, ABSENT
 * (`unset`), and PRESENT BUT UNUSABLE — `a value that is not a number (N chars,
 * not echoed here) (not a percentage)`. The third used to collapse into
 * `unset`, which made a typo render as both sides agreeing on nothing and still
 * demanding a restart.
 */
function describeHalf(
  parsed: number | null,
  rawNote: string | undefined,
  unit: string,
  unusable: string
): string {
  if (parsed !== null) return `${String(parsed)}${unit}`;
  // The note is already bounded at its source (MED-2); this line reaches stdout
  // and the nextActions a consumer logs, so it never carries the raw text.
  if (rawNote !== undefined) return `${rawNote} (${unusable})`;
  return `unset${unit}`;
}

/** One pair in the `N tokens × P%` form both halves of the restart line use. */
function describePair(
  pair: HarnessCompactThresholdReadResult['configured'],
  raw: HalfNotes | undefined
): string {
  const window = describeHalf(pair.windowTokens, raw?.windowRawNote, '', 'not a token count');
  const percent = describeHalf(pair.percent, raw?.percentRawNote, '%', 'not a percentage');
  return `${window} tokens × ${percent}`;
}

/**
 * The restart line, or null when there is nothing to restart for.
 *
 * It exists because the harness reads its env ONCE at process start: after
 * peaks-loop changes the project file, the running session keeps the old
 * threshold until it is restarted. Saying "configured" without saying "and it
 * is not in force yet" would be the pretending this slice removes.
 *
 * Both sides are rendered from "present vs absent" as well as their parsed
 * values, so a file holding a typo says so instead of reading as an empty slot —
 * see `HarnessCompactThresholdRawValues`. The typo itself is described by a
 * BOUNDED note, never echoed (MED-2).
 *
 * N6 — A KNOB THE FILE DOES NOT SET IS NOT PART OF THE COMPARISON. When the
 * file holds only the percent, the `N tokens × P%` form rendered `unset tokens`
 * for a window the project never configured, on BOTH sides of a sentence that is
 * about what changed. The halves named are therefore the FILE's: a project that
 * configures the percent alone is reported in percent-only terms.
 */
/** One side's two bounded notes, in the pair shape `describeSide` reads. */
interface HalfNotes {
  readonly windowRawNote: string | undefined;
  readonly percentRawNote: string | undefined;
}

export function describeHarnessThresholdRestart(
  read: HarnessCompactThresholdReadResult
): string | null {
  if (read.matches) return null;
  const fileRaw: HalfNotes | undefined =
    read.raw === undefined
      ? undefined
      : { windowRawNote: read.raw.windowRawNote, percentRawNote: read.raw.percentRawNote };
  const envRaw: HalfNotes | undefined =
    read.raw === undefined
      ? undefined
      : {
          windowRawNote: read.raw.envWindowRawNote,
          percentRawNote: read.raw.envPercentRawNote
        };
  const halves = halvesConfiguredBy(read.configured, fileRaw);
  const fileHalf = describeSide(halves, read.configured, fileRaw);
  const sessionHalf = describeSide(halves, read.inForce, envRaw);
  return (
    `Harness threshold NOT in force in this session: ${read.settingsPath} configures ` +
    `${fileHalf}, but the running session uses ${sessionHalf} — the harness reads these ` +
    'variables once, at process start. Restart the session (or the window) so the new configuration applies.'
  );
}

/** Which halves the FILE configures: a parsed value or a present note, either counts. */
function halvesConfiguredBy(
  configured: HarnessCompactThresholdReadResult['configured'],
  raw: HalfNotes | undefined
): { readonly window: boolean; readonly percent: boolean } {
  return {
    window: configured.windowTokens !== null || raw?.windowRawNote !== undefined,
    percent: configured.percent !== null || raw?.percentRawNote !== undefined
  };
}

/** One side of the restart line, in exactly the halves the FILE configures. */
function describeSide(
  halves: { readonly window: boolean; readonly percent: boolean },
  pair: HarnessCompactThresholdReadResult['configured'],
  raw: HalfNotes | undefined
): string {
  if (halves.window && halves.percent) return describePair(pair, raw);
  if (halves.percent)
    return describeHalf(pair.percent, raw?.percentRawNote, '%', 'not a percentage');
  if (halves.window)
    return `${describeHalf(pair.windowTokens, raw?.windowRawNote, '', 'not a token count')} tokens`;
  return 'no harness threshold';
}
