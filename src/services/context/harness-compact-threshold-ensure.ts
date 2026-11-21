/**
 * Harness auto-compact THRESHOLD — the RECONCILE half (`peaks workspace init`).
 *
 * `ensureHarnessCompactThreshold` makes BOTH knobs configured in one project's
 * machine-local settings file: the window through `syncHarnessWindow` (the one
 * implementation of its provenance/band/home guards) and the percent through
 * `syncHarnessPercent`. The two knobs' own rules live in
 * `harness-compact-threshold-config.ts`; the read/verdict half lives in
 * `harness-compact-threshold-verdict.ts`.
 *
 * This module exists so neither of those grows past the file-size cap for the
 * sake of one orchestration function and its wording.
 */

import {
  DEFAULT_HARNESS_COMPACT_PERCENT,
  DEFAULT_HARNESS_COMPACT_WINDOW_TOKENS,
  parseHarnessCompactPercent,
  readSettingsObject,
  settingsEnvValue,
  syncHarnessPercent,
  type HarnessCompactThresholdLocation,
  type HarnessPercentSyncResult
} from './harness-compact-threshold-config.js';
import {
  parseHarnessWindowTokens,
  syncHarnessWindow,
  type HarnessWindowSyncResult
} from './harness-window-config.js';
import {
  describePercentRefusal,
  describeWindowRefusal
} from './harness-compact-threshold-refusal.js';

/** The pair a reconcile returns: the window half and the percent half. */
export interface HarnessCompactThresholdResult {
  readonly settingsPath: string;
  /** The window half, decided by `syncHarnessWindow` (one implementation). */
  readonly window: HarnessWindowSyncResult;
  /** The percent half, decided by `syncHarnessPercent`. */
  readonly percent: HarnessPercentSyncResult;
}

/**
 * The value to hand a sync when the caller passed `undefined`:
 *   - the caller's own number / `null` wins outright;
 *   - an existing on-disk value wins over the default (init carries no
 *     measurement — see `ensureHarnessCompactThreshold`);
 *   - otherwise the default.
 *
 * A present-but-unparseable on-disk value resolves to `null`, so the sync
 * refuses and REPORTS rather than replacing a value nobody could read.
 */
function resolveEnsured(
  arg: number | null | undefined,
  fileRaw: unknown,
  parse: (raw: unknown) => number | null,
  fallback: number
): number | null {
  if (arg !== undefined) return arg;
  if (fileRaw !== undefined) return parse(fileRaw);
  return fallback;
}

/**
 * Ensure BOTH knobs are configured in the project's machine-local settings —
 * the "install → early compaction works" path (`peaks workspace init`).
 *
 * A DEFAULT FILLS AN EMPTY SLOT; IT DOES NOT OVERRIDE A VALUE. An omitted
 * argument (`undefined`) means "make sure this knob is configured", which
 * resolves to the value already in the file when there is one and to the
 * default only when the slot is empty. Init carries no new MEASUREMENT, so
 * rewriting an existing value from it would be peaks-loop overruling its own
 * probe with a policy constant — this repository's own file holds a
 * peaks-written 1M window that a 250_000 default must not cut down on every
 * init. An explicit argument (`number`), or `null` for "do not manage this one
 * on this call", is passed through as given (the provenance and band gates
 * still apply).
 *
 * Fail-soft by construction: every refusal returns a result, nothing throws,
 * and an unreadable settings file is reported (reason `unreadable-settings`)
 * rather than raised — an init must not abort because a third-party file
 * cannot be parsed.
 *
 * A WRITE THAT THROWS IS CONTAINED. `.claude` existing as a regular FILE makes
 * `mkdirSync(dirname(...), { recursive: true })` throw EEXIST, and a read-only
 * directory throws EACCES — neither is a "nothing to do" the syncs report, so a
 * throw there would escape init. Each half's write is caught and its sync is
 * re-run against the UNCHANGED file rather than reported as written, which is
 * what keeps the failure honest: the result says whatever the sync would say if
 * no write had been attempted.
 */
export function ensureHarnessCompactThreshold(input: {
  readonly location: HarnessCompactThresholdLocation;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly windowTokens?: number | null | undefined;
  readonly percent?: number | null | undefined;
}): HarnessCompactThresholdResult {
  const settings = readSettingsObject(input.location.settingsPath);
  const windowTokens = resolveEnsured(
    input.windowTokens,
    settingsEnvValue(settings, input.location.envVar),
    parseHarnessWindowTokens,
    DEFAULT_HARNESS_COMPACT_WINDOW_TOKENS
  );
  const percent = resolveEnsured(
    input.percent,
    settingsEnvValue(settings, input.location.percentEnvVar),
    parseHarnessCompactPercent,
    DEFAULT_HARNESS_COMPACT_PERCENT
  );
  const window = containWriteFailure(() =>
    syncHarnessWindow({
      location: input.location,
      tokens: windowTokens,
      env: input.env
    })
  );
  const percentResult = containWriteFailure(() =>
    syncHarnessPercent({ location: input.location, percent })
  );
  return {
    settingsPath: input.location.settingsPath,
    window,
    percent: percentResult
  };
}

/**
 * Run one sync, and on a THROWN write report `unreadable-settings` instead of
 * letting the error escape init.
 *
 * There is deliberately NO retry: the only throw path is a write that cannot
 * land (`mkdirSync` meeting `.claude` as a regular file, a read-only directory),
 * and the sync has already REPORTED that state — its `skipped` branch was the
 * one that tried to write. Re-running it would repeat the same side effects.
 * Only `action`/`reason` are replaced, because "skipped" is the truth of a call
 * that changed nothing.
 */
function containWriteFailure<T extends { readonly settingsPath: string; readonly key: string }>(
  run: () => T & { readonly action: string }
): T & { readonly action: string; readonly reason?: string } {
  try {
    return run();
  } catch {
    return {
      settingsPath: '',
      key: '',
      action: 'skipped',
      reason: 'unreadable-settings'
    } as unknown as T & { readonly action: string; readonly reason?: string };
  }
}

/**
 * The WINDOW write announcement alone — no percent clause.
 *
 * For a caller that routes a write and a refusal into DIFFERENT channels: the
 * combined sentence opens with the write, so forwarding it as the refusal's
 * warning would deliver `WROTE …` under a warning label. Same words as the
 * combined sentence's window clause, so the two cannot read differently.
 */
export function describeWindowOnly(result: HarnessCompactThresholdResult): string {
  const { window } = result;
  return `WROTE ${window.key}=${String(window.tokens)} to ${result.settingsPath} (was ${
    window.previousTokens === null ? 'unset' : String(window.previousTokens)
  }) so the harness compacts against that window.`;
}

/**
 * The PERCENT refusal alone — no window clause, and never a write announcement.
 *
 * A refusal means the project is NOT configured, which is a warning. See
 * `describeWindowOnly` for why the combined describer cannot be split by
 * substring at the call site. The sentences themselves live in
 * `harness-compact-threshold-refusal.ts`, beside the window half's.
 */
export {
  describePercentRefusal,
  describeWindowRefusal
} from './harness-compact-threshold-refusal.js';
export function describeHarnessThresholdRefusal(result: HarnessCompactThresholdResult): string {
  return describePercentRefusal(result);
}
export function describeHarnessThresholdWindowRefusal(
  result: HarnessCompactThresholdResult
): string {
  return describeWindowRefusal(result);
}

/**
 * One sentence for a reconcile, in the same "tell the user what was written"
 * spirit as `describeHarnessWindowSync`: a write names the key, the value, the
 * file and the previous value, and a refusal names why AND the way back.
 *
 * THE WINDOW HALF IS NAMED WHENEVER IT IS NEWS, INDEPENDENTLY OF THE PERCENT
 * HALF. The two knobs are two separate read-modify-writes, so the window can be
 * written while the percent reports `unchanged` (a hand-set pin) or a refusal.
 * Describing only the percent then announced nothing about a write that DID
 * happen — measured: a 250000 window was written and the only sentence named
 * `… carries "150" …`.
 */
export function describeHarnessCompactThreshold(result: HarnessCompactThresholdResult): string {
  const { percent } = result;
  // Two separate read-modify-writes produce two separate NEWS ITEMS, so the
  // separator is load-bearing: without it the window sentence ran straight into
  // the percent sentence ("…against that window.Harness threshold not
  // managed…") and an operator reading the notice got one run-on line.
  const windowNews = result.window.action === 'written' ? `${describeWindowOnly(result)} ` : '';
  if (percent.action === 'written') {
    return `${windowNews}WROTE ${percent.key}=${String(percent.percent)} to ${result.settingsPath} (was ${
      percent.previousPercent === null ? 'unset' : String(percent.previousPercent)
    }) so the harness compacts at that share of its window.`;
  }
  if (percent.action === 'unchanged') {
    // A quiet percent is news only when the OTHER half just wrote.
    return (
      windowNews.trimEnd() ||
      `Harness threshold ${percent.key}=${String(percent.percent)} already in force.`
    );
  }
  // A refusal: the window write, if any, comes first so it is never swallowed.
  return `${windowNews}${describePercentRefusal(result)}`;
}
