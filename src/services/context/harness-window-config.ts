/**
 * Harness auto-compact window ownership
 * (slice 2026-09-13-auto-compact-trigger-ownership, rid
 * 2026-09-13-auto-compact-trigger-ownership).
 *
 * The goal (user's words): *when* to trigger auto-compact must be
 * peaks-loop's decision; *how* to compact stays the harness's capability.
 *
 * That only holds if the two sides agree on ONE number. Before this slice
 * they each resolved a window independently: Claude Code used the window it
 * knows for the model, while peaks-loop divided by `resolveContextWindow()`
 * (env → config → model-name heuristic → 200_000 default). A 1M-window model
 * whose id the heuristic does not recognise made peaks-loop's "95%" land at
 * 190K while the harness waited for ~967K — a 5× early trigger, and (before
 * T3) a deadlock, because nothing could lower the ratio.
 *
 * This module owns the OTHER half of the fix: the harness itself accepts a
 * window override (`IdeCompactProfile.autoCompactWindowEnvVar`, declared per
 * adapter — no IDE names here), so peaks-loop writes the very number it
 * computes the ratio against into the harness's own machine-local settings
 * file. Reader and writer then reference one artifact instead of two
 * resolutions that must "remember" to agree.
 *
 * Vendor neutrality: this module knows about a JSON file with an `env` block
 * and nothing else. The settings path and the env-var name are BOTH passed
 * in by the caller, resolved from the IDE adapter's declarations. There is
 * no IDE id, no `.claude` literal, and no registry import in this file.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { projectRootsMatch } from '../../shared/path-utils.js';

/**
 * Peaks-owned opt-out flag, read from the SAME machine-local `env` block the
 * window key is written to.
 *
 * Why it exists: `resetHarnessWindow` must be a real rollback. Without a
 * durable opt-out, the next context probe would simply write the key back
 * and the user's "remove it" would last until the next tool call — a
 * rollback in name only. Absent (or any value other than `off`) = sync is
 * enabled, which keeps every project installed by an earlier release
 * unchanged.
 */
export const HARNESS_WINDOW_SYNC_OPTOUT_KEY = 'PEAKS_HARNESS_WINDOW_SYNC';

/** The one value that disables the sync. */
export const HARNESS_WINDOW_SYNC_OPTOUT_VALUE = 'off';

/**
 * Provenance marker: the window value peaks-loop ITSELF last wrote, recorded
 * in the same `env` block as the window key.
 *
 * Why it must exist. The window key is a SHARED artifact — the harness reads
 * it, the user may set it by hand (it is a documented Claude Code variable),
 * and peaks-loop writes it. Two rules collide on it:
 *
 *   - the ratio peaks-loop reports must divide by the key (the single-source
 *     rule), so the key outranks the model heuristic; and
 *   - a first-time mis-resolution must not become PERMANENT.
 *
 * The second rule needs the late 1M rescue to be able to overrule the key when
 * the observed context proves the key too small. Applied to a value a HUMAN
 * pinned, that same rescue would silently destroy an explicit setting — the
 * user asks for an early compact, a long session outgrows the pin, and
 * peaks-loop rewrites the file to 1M, permanently. Applied to peaks-loop's own
 * earlier output it is simply self-correction.
 *
 * This marker is what tells the two apart: it records what peaks-loop wrote,
 * so a mismatch means the human has taken the key over and the rescue must
 * stand down. It travels in the same write as the value it describes, so the
 * two can never disagree about which write they belong to.
 */
export const HARNESS_WINDOW_WRITTEN_KEY = 'PEAKS_HARNESS_WINDOW_WRITTEN';

/** Where the harness key lives + which key it is. Both caller-supplied. */
export interface HarnessWindowLocation {
  /** Absolute path of the machine-local settings file. */
  readonly settingsPath: string;
  /** Env var / settings key the harness reads its auto-compact window from. */
  readonly envVar: string;
  /**
   * The project root `settingsPath` was derived from, when the caller knows it.
   *
   * Why the writer wants it: `--project .` with the shell sitting in the user's
   * home directory resolves the "project root" to `$HOME` itself, which puts
   * this file at `$HOME/.claude/settings.local.json` — the user's PERSONAL
   * harness settings, shared by every project they own and outside any repo
   * peaks-loop has business editing. A new terminal starts in `$HOME`, so that
   * combination is the ordinary one, not an exotic one. The writer refuses it
   * (reason `unsafe-project-root`) and says so instead of writing.
   *
   * Optional: callers that legitimately operate on a temp directory or on a
   * path they built themselves simply omit it, and no check is made. Compared
   * with `projectRootsMatch`, never by string equality — the caller may pass
   * `C:/Users/x` where `homedir()` yields `C:\Users\x`.
   */
  readonly projectRoot?: string;
}

/** Which artifact a value was read from. */
export type HarnessWindowValueSource = 'process-env' | 'settings-file';

export interface HarnessWindowReadResult {
  /** Parsed window in tokens, or null when absent / not a positive integer. */
  readonly tokens: number | null;
  /** The raw on-disk / in-env value, for diagnostics. */
  readonly raw: unknown;
  /** Where the value came from; null when neither side carries it. */
  readonly source: HarnessWindowValueSource | null;
  /**
   * The SETTINGS FILE's window, parsed — the value the harness will carry
   * tomorrow, independent of the frozen process env. `null` when the file is
   * silent or its value is unparseable.
   *
   * This is the T1 number, and it is deliberately separate from `tokens`:
   * `tokens` answers "what is in force in the running session?" (env-first,
   * for the status read), while `fileTokens` answers "what is configured for
   * the harness?" — the one artifact peaks-loop can keep consistent with its
   * own ratio. See `resolveHarnessRatioWindow` in `auto-compact-reader.ts`.
   */
  readonly fileTokens: number | null;
  /**
   * The settings file's raw value, `undefined` when the file carries no such
   * key. Presence-detection only; use `fileTokens` for the number.
   *
   * Needed because "the file says 150000" and "the file says something
   * unparseable" must both be distinguishable from "the file is silent": the
   * first two are values peaks-loop must not overwrite, the third is an empty
   * slot it may fill.
   */
  readonly fileRaw: unknown;
  /** True when `settings.local.json` opts out of peaks-loop managing it. */
  readonly optedOut: boolean;
  /**
   * True when peaks-loop is the current writer of this key — the file's window
   * value still matches the `HARNESS_WINDOW_WRITTEN_KEY` marker peaks-loop
   * wrote with it. False when the key is unset, or when its value differs from
   * the marker, i.e. a human has taken the key over.
   *
   * Deliberately decided from the FILE's value, not from whichever copy
   * (`process-env` / `settings-file`) supplied `tokens` this time. A running
   * session freezes its env at start-up, so after peaks-loop raises the file
   * the env still hands back the superseded number; judging by that copy would
   * report "a human set this" about peaks-loop's own value and switch the late
   * 1M rescue off on the next probe.
   *
   * The caller uses this to decide whether the late 1M rescue may overrule the
   * harness layer: peaks-loop's own output may be corrected, a human's pin may
   * not. See `resolveContextWindowTokens`.
   */
  readonly peakWritten: boolean;
}

export type HarnessWindowSyncAction = 'written' | 'unchanged' | 'skipped';

export interface HarnessWindowSyncResult {
  readonly settingsPath: string;
  /** The key written / read (the adapter-declared `autoCompactWindowEnvVar`). */
  readonly key: string;
  readonly action: HarnessWindowSyncAction;
  /**
   * Why the sync did nothing. Present only when `action === 'skipped'`:
   *   - `no-window-resolved`  — the caller had no token window to write
   *                             (percent-only probe sources carry none)
   *   - `opted-out`           — the user ran the rollback
   *   - `unreadable-settings` — the file exists but is not a JSON object we
   *                             can safely edit
   *   - `not-peaks-owned`     — the file already carries a value that
   *                             peaks-loop did not write (a human's pin, or
   *                             another tool's). peaks-loop never rewrites it
   *                             and never re-arms its provenance marker for
   *                             it; the value wins over peaks-loop's own
   *                             resolution instead. This is the B1 guard —
   *                             without it a stale process env (or any
   *                             re-resolution) silently reverts a human's
   *                             hand-edited window and re-claims ownership.
   *   - `unsafe-project-root` — the resolved project root IS the user's home
   *                             directory, so this write would land in their
   *                             personal `~/.claude/settings.local.json`
   *                             (`--project .` from a fresh terminal). The H1
   *                             guard; `--reset` is deliberately still allowed
   *                             there, because removing a key an earlier
   *                             release put in `$HOME` is the user's explicit
   *                             recovery path.
   */
  readonly reason?: string;
  /** The value in force after the call. */
  readonly tokens: number | null;
  /**
   * The value the SETTINGS FILE held before the call (null when absent — or
   * when the file is unreadable). Deliberately the file's value, not the
   * process env's: the file is what the next session reads, so it is what the
   * caller must quote back to the user ("was 200000") and what decides whether
   * a write is needed at all.
   */
  readonly previousTokens: number | null;
  /**
   * The window the caller ASKED to materialize — the denominator it computed
   * that probe's ratio against (`probe.capacityTokens`). `null` when the
   * caller carried no token window at all.
   *
   * Why it is reported rather than left at the call site: the interesting
   * outcome is a DISAGREEMENT, and a disagreement takes two numbers. A result
   * that carried only "what is in force" left every consumer unable to name
   * what it disagrees WITH — the notice for a refused write could say that
   * nothing was written and never which two numbers were apart. See
   * `describeHarnessWindowSync`.
   */
  readonly requestedTokens: number | null;
  /**
   * The file's RAW value for the key before the call; `undefined` when the
   * file carried no such key.
   *
   * The one case `previousTokens` cannot express: a hand-typed `500k` parses
   * to `null`, exactly like an absent key, yet the two need opposite notices —
   * an absent key is a slot peaks-loop may fill, a typo is a value it must not
   * touch. Only the raw text can be quoted back to the user, so it travels
   * with the result.
   */
  readonly previousRawValue: unknown;
  /**
   * True when the window in the file after the call is peaks-loop's own write
   * (its value matches the provenance marker).
   *
   * Reported because "the file already holds the number we wanted" has two very
   * different meanings and only this flag tells them apart: peaks-loop's own
   * earlier output, which it may raise when a session outgrows it, versus a
   * value a human pinned, which it never will. Without it, `unchanged` reads as
   * "all good" for a key peaks-loop has permanently stopped managing — the
   * state a user upgrading from a pre-marker release is silently in.
   *
   * Always `true` for `action: 'written'`: the write that produced the result
   * is what sets the marker.
   */
  readonly peakWritten: boolean;
}

export type HarnessWindowResetResult = {
  readonly settingsPath: string;
  readonly action: 'removed' | 'absent';
  readonly previousTokens: number | null;
};

/**
 * The ONE wording of "what the harness-window sync just did", for both
 * commands that sync (`peaks code context-now`, `peaks code auto-compact`).
 *
 * Why it lives here rather than inline at each call site: peaks-loop rewrites
 * a file in the user's own harness settings on every probe, and the user
 * accepted that write on one condition — 要告知 (tell me). Two copies of the
 * sentence would mean a future edit tells half the users. This is the only
 * definition; the CLI renders whatever it returns.
 *
 * The `written` branch is the load-bearing one: it names the key, the value,
 * the file, what the value was before, and the exact rollback command, because
 * the harness itself reports an override only through `/autocompact` — if
 * peaks-loop does not say it here, nobody says it.
 *
 * The `skipped` branch is the one that is easy to get wrong, and did: it used
 * to end at the reason token (`Harness window not managed (not-peaks-owned).`),
 * which is true and tells the reader nothing. A refusal can be the exact
 * moment the two sides came apart — the ratio divided by one number while the
 * file pins another — so it is composed from the reason, the two numbers when
 * they disagree, and the raw value when the file's value is not a number at
 * all. See `harnessWindowConflictClause` / `unreadableWindowValueClause`.
 */
export function describeHarnessWindowSync(result: HarnessWindowSyncResult | null): string {
  if (result === null) {
    return 'The active IDE adapter declares no auto-compact window key; this ratio cannot be tied to the harness trigger.';
  }
  if (result.action === 'written') {
    return `WROTE ${result.key}=${String(result.tokens)} to ${result.settingsPath} (was ${result.previousTokens === null ? 'unset' : String(result.previousTokens)}) so the harness compacts at the same point this ratio measures. Rollback: \`peaks compact harness-window --reset\`.`;
  }
  if (result.action === 'skipped') {
    // A refused write is NOT automatically a non-event. The two clauses below
    // are the whole point of refusing to stop at the reason token: each names a
    // concrete NUMBER the user can act on, because "not managed" alone left the
    // reader unable to tell whether the two sides still agreed.
    return `${skippedHarnessWindowClause(result)}${harnessWindowConflictClause(result)}${unreadableWindowValueClause(result)}`;
  }
  // `unchanged` — the file already holds exactly the window this probe divided
  // by, so there is no disagreement to report. What can still be hidden is
  // OWNERSHIP, and it decides what happens when the session outgrows the value.
  // A user upgrading from a release that wrote the key before the provenance
  // marker existed lands here (that is this repository's own state): the value
  // is in force, peaks-loop computes against it, and nothing anywhere said it
  // had become frozen — so "already in force" alone is not a full notice.
  if (!result.peakWritten) {
    return `Harness window ${result.key}=${String(result.tokens)} already in force, but it is NOT peaks-loop's own write: peaks-loop divides this ratio by it and will never raise it, so a session that outgrows ${String(result.tokens)} saturates the ratio at 1.0 instead of widening the window. To hand the key back to peaks-loop: \`peaks compact harness-window --reset\` (removes it), then \`peaks compact harness-window --reenable\` (the next probe fills it).`;
  }
  return `Harness window ${result.key} already in force; peaks-loop computes this ratio against it.`;
}

/**
 * The same disagreement as `harnessWindowConflictClause`, reduced to one line
 * for the `warnings` channel — the machine-readable half of 要告知, so a
 * consumer reading the JSON envelope (or a human reading stderr) sees it even
 * if it never renders `nextActions`. Returns `null` when there is nothing to
 * warn about, which is the ordinary case.
 */
export function harnessWindowSyncWarning(result: HarnessWindowSyncResult | null): string | null {
  if (result === null || result.action !== 'skipped') return null;
  if (
    result.requestedTokens !== null &&
    result.previousTokens !== null &&
    result.requestedTokens !== result.previousTokens
  ) {
    return `harness window conflict: this probe divided by ${result.requestedTokens} tokens but ${result.settingsPath} pins ${result.previousTokens} — the ratio does not describe the harness's own trigger`;
  }
  if (result.previousTokens === null && result.previousRawValue !== undefined) {
    return `harness window unreadable: ${result.settingsPath} carries ${JSON.stringify(result.previousRawValue)}, which is not a plain token count`;
  }
  return null;
}

/**
 * WHY nothing was written, in words — one clause per `reason`.
 *
 * Every reason has its own sentence rather than falling through to
 * `(${reason})`: the bare token was what the user actually saw for the two
 * most common refusals, and it names no value, no file, and no next step.
 * The trailing clause is unreachable for the reasons this module produces
 * today; it exists so a future reason cannot silently degrade to a token.
 */
function skippedHarnessWindowClause(result: HarnessWindowSyncResult): string {
  switch (result.reason) {
    case 'opted-out':
      return 'Harness window not managed (opted-out) — re-enable with `peaks compact harness-window --reenable`.';
    case 'unsafe-project-root':
      return `Harness window not managed: ${result.settingsPath} is the user's own home settings, not a project's, so peaks-loop left it alone. Re-run from inside a project (or point at one) and the window lands there instead.`;
    case 'no-window-resolved':
      return 'Harness window not managed: this probe measured a percentage and carried no token window, so there was no number to write — peaks-loop does not invent a window the adapter did not resolve.';
    case 'unreadable-settings':
      return `Harness window not managed: ${result.settingsPath} is not a JSON object peaks-loop can safely edit, so it was left exactly as found.`;
    case 'not-peaks-owned':
      return `Harness window not managed: ${result.settingsPath} already carries a window that peaks-loop did not write, and peaks-loop never overwrites (or claims) a value it did not write.`;
    default:
      return `Harness window not managed (${String(result.reason)}).`;
  }
}

/**
 * THE DISAGREEMENT SENTENCE — the one the user cannot get anywhere else.
 *
 * peaks-loop divided this probe's ratio by `requestedTokens`, while the
 * harness's own settings file pins `previousTokens`. Neither side is wrong on
 * its own, which is exactly why it went unnoticed: the file wins for the ratio
 * (T1's single-source rule), the write that would have re-unified them was
 * refused (B1's provenance guard), and the result was a percentage computed
 * against a window the harness is not going to fire on. The harness reports an
 * override only through its own `/autocompact`, so if peaks-loop does not name
 * the two numbers here, nobody does.
 *
 * Both numbers and the file are named, and all three ways out are given,
 * because this notice is the whole remedy for a state peaks-loop deliberately
 * refuses to fix by writing.
 */
function harnessWindowConflictClause(result: HarnessWindowSyncResult): string {
  const requested = result.requestedTokens;
  const pinned = result.previousTokens;
  if (result.action !== 'skipped' || requested === null || pinned === null || requested === pinned) return '';
  return ` CONFLICT: peaks-loop divided this ratio by ${requested} tokens, but ${result.settingsPath} pins ${pinned} — and the harness compacts on ITS own number, so this ratio does not describe when it fires. Nothing was written. Choose one: (1) make peaks-loop's number match the file (unset PEAKS_CONTEXT_WINDOW_TOKENS, or change \`context.windowTokens\`), (2) keep the file as your own setting and read this ratio as a share of ${requested}, or (3) \`peaks compact harness-window --reset\` to remove the key and hand it back to peaks-loop.`;
}

/**
 * The OTHER way two numbers can fail to line up: the file's value is not a
 * number at all (`500k`, a hand-typed typo).
 *
 * `previousTokens` is `null` here — indistinguishable, in the parsed result,
 * from an absent key — so this clause is gated on the RAW value. The
 * disagreement is stated but never "aligned": peaks-loop will not overwrite a
 * value it did not write, and the value is unusable, so the only honest output
 * is to name it and hand the user the two ways out. Silent here would be the
 * worst option of all, because the caller has already fallen back to a
 * different window and the disk keeps claiming `500k` on every probe after it.
 */
function unreadableWindowValueClause(result: HarnessWindowSyncResult): string {
  if (result.action !== 'skipped' || result.previousTokens !== null || result.previousRawValue === undefined) return '';
  const raw = JSON.stringify(result.previousRawValue);
  return ` The value in ${result.settingsPath} is ${raw}, which is not a plain token count: peaks-loop cannot read a window from it, so it resolved this ratio against its own fallback while the file keeps saying ${raw}. peaks-loop cannot align the two without overwriting a value it did not write — set the value to a plain token count, or run \`peaks compact harness-window --reset\` to remove the key and let the next probe write peaks-loop's number.`;
}

/**
 * Parse a candidate window value. Positive finite integers only — a number,
 * or a numeric string (the env block is JSON, so the value on disk is always
 * a string there). The harness's own documentation is explicit that the
 * variable "accepts only the plain token count" and NOT a `850k` suffix, so
 * anything non-integral is refused here rather than written and silently
 * ignored downstream.
 */
export function parseHarnessWindowTokens(raw: unknown): number | null {
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  if (typeof raw === 'string' && raw.trim().length === 0) return null;
  const parsed = typeof raw === 'number' ? raw : Number(raw.trim());
  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

interface SettingsFileShape {
  readonly env?: Record<string, unknown>;
}

/**
 * Read the settings file as a JSON object. Returns null when the file is
 * absent, unparseable, or not an object — the caller treats that as "cannot
 * manage" rather than throwing, because a corrupt local settings file must
 * never break a context probe.
 */
function readSettingsObject(settingsPath: string): SettingsFileShape | null {
  if (!existsSync(settingsPath)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(settingsPath, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as SettingsFileShape;
  } catch {
    return null;
  }
}

/** True when the file is absent (editable) or a parseable JSON object. */
function isEditable(settingsPath: string): boolean {
  if (!existsSync(settingsPath)) return true;
  return readSettingsObject(settingsPath) !== null;
}

/**
 * True when `candidate` is the user's home directory itself.
 *
 * `projectRootsMatch` (not `===`) because the two strings reach this function
 * from different sources: a CLI `--project` argument may arrive as
 * `C:/Users/x` or with different casing, while `homedir()` yields the OS form.
 * Tolerating a probe of a *subdirectory* of `$HOME` is deliberate — `~/proj`
 * is an ordinary project — so this is an exact match, not `isInsidePath`.
 */
function isUserHome(candidate: string): boolean {
  try {
    return projectRootsMatch(candidate, homedir());
  } catch {
    // A path that cannot be resolved is not a claim about the home directory;
    // the write itself will surface any real problem.
    return false;
  }
}

function envString(settings: SettingsFileShape | null, key: string): unknown {
  const env = settings?.env;
  if (typeof env !== 'object' || env === null || Array.isArray(env)) return undefined;
  return (env as Record<string, unknown>)[key];
}

/**
 * Read the window the harness is currently using for auto-compact.
 *
 * Order: the process env FIRST (that is the value the RUNNING session
 * captured at start-up, so it is what the harness is actually compacting
 * against right now), then the settings file (what the next session will
 * read). When the two disagree, the file is what the sync updates — the
 * process env cannot be changed from inside a running session.
 */
export function readHarnessWindow(input: {
  readonly location: HarnessWindowLocation;
  readonly env?: NodeJS.ProcessEnv | undefined;
}): HarnessWindowReadResult {
  const settings = readSettingsObject(input.location.settingsPath);
  const optedOut = envString(settings, HARNESS_WINDOW_SYNC_OPTOUT_KEY) === HARNESS_WINDOW_SYNC_OPTOUT_VALUE;

  // Provenance is a property of the KEY — "is peaks-loop the current writer of
  // this key?" — so it is decided by the FILE's value against the marker,
  // never by whichever copy happens to be in force.
  //
  // That distinction is load-bearing. A running session freezes the process
  // env at start-up, so after peaks-loop refreshes the file the env still
  // carries the PREVIOUS value. Comparing the marker against the in-force copy
  // would then report "a human set this" for peaks-loop's own superseded
  // number, switch the late 1M rescue off, and re-pin the ratio at 1.0 on the
  // very next probe — the self-lock, restored through the back door. Against
  // the file value the answer is stable: still ours, so still correctable.
  const marker = parseHarnessWindowTokens(envString(settings, HARNESS_WINDOW_WRITTEN_KEY));
  const fileRaw = envString(settings, input.location.envVar);
  const fileTokens = parseHarnessWindowTokens(fileRaw);
  const peakWritten = fileTokens !== null && marker === fileTokens;

  const fromEnv = input.env?.[input.location.envVar];
  if (fromEnv !== undefined) {
    return {
      tokens: parseHarnessWindowTokens(fromEnv), raw: fromEnv, source: 'process-env',
      optedOut, peakWritten, fileTokens, fileRaw
    };
  }
  if (fileRaw !== undefined) {
    return { tokens: fileTokens, raw: fileRaw, source: 'settings-file', optedOut, peakWritten, fileTokens, fileRaw };
  }
  return {
    tokens: null, raw: undefined, source: null, optedOut, peakWritten: false,
    fileTokens: null, fileRaw: undefined
  };
}

/**
 * Write `tokens` as the harness's auto-compact window. Idempotent: a re-run
 * with the same value performs no write at all, so repeated calls (the sync
 * runs on every context probe) cannot churn the file or duplicate the entry.
 *
 * Everything else in the file is preserved verbatim — the caller's own `env`
 * entries, every `hooks` entry, and any unknown top-level key. This is the
 * same read-modify-write discipline `auto-compact-hook-install.ts` already
 * applies to this file; there are now two writers, and both must leave the
 * other's rows alone.
 */
export function syncHarnessWindow(input: {
  readonly location: HarnessWindowLocation;
  readonly tokens: number | null;
  readonly env?: NodeJS.ProcessEnv | undefined;
}): HarnessWindowSyncResult {
  const settingsPath = input.location.settingsPath;
  const current = readHarnessWindow({ location: input.location, env: input.env });
  const fileSettings = readSettingsObject(settingsPath);
  const fileRaw = envString(fileSettings, input.location.envVar);
  const fileTokens = parseHarnessWindowTokens(fileRaw);
  // Every branch spreads this, so `requestedTokens` and `previousRawValue`
  // travel with the outcome rather than being re-derived by each consumer.
  const base = {
    settingsPath,
    key: input.location.envVar,
    previousTokens: fileTokens,
    previousRawValue: fileRaw,
    requestedTokens: input.tokens,
    peakWritten: current.peakWritten
  };

  if (current.optedOut) {
    return { ...base, action: 'skipped', reason: 'opted-out', tokens: current.tokens };
  }
  // The H1 guard: never target the user's own home directory. See
  // `HarnessWindowLocation.projectRoot` for the trigger (`--project .` from a
  // fresh terminal, whose cwd is `$HOME`). Refused here rather than by
  // narrowing the shared project-root resolver: `findProjectRoot` deliberately
  // stops below `$HOME` and `resolveCanonicalProjectRoot` is called from every
  // command in the CLI, so a change there would move behaviour for all of them
  // to close one writer's hazard. The check is exact-home only — `~/my-project`
  // is a perfectly good project and is still written.
  if (input.location.projectRoot !== undefined && isUserHome(input.location.projectRoot)) {
    return { ...base, action: 'skipped', reason: 'unsafe-project-root', tokens: current.tokens };
  }
  if (input.tokens === null) {
    return { ...base, action: 'skipped', reason: 'no-window-resolved', tokens: current.tokens };
  }
  if (!isEditable(settingsPath)) {
    return { ...base, action: 'skipped', reason: 'unreadable-settings', tokens: current.tokens };
  }
  // Idempotence is a property of the FILE, not of the process env. A running
  // session keeps the value it captured at start-up, so comparing against the
  // read (env first) would report "changed" on every probe of that session and
  // rewrite a byte-identical file each time.
  if (fileTokens === input.tokens) {
    return { ...base, action: 'unchanged', tokens: input.tokens };
  }
  // THE B1 GUARD. peaks-loop may update a value it wrote itself, and it may
  // FILL an empty slot — but it must never overwrite a value it did not write.
  //
  // Round 2 decided this gate by comparing the file against the resolved
  // window, and the resolved window is read env-first. So provenance gated the
  // 1M *bump* but never the *write*: a human hand-edited the key from the
  // 200000 peaks-loop wrote to 150000, a stale process env still said 200000,
  // and the next probe reverted the human's edit and re-armed the marker — the
  // marker then authorising the very rescue that raised the human's key to
  // 1000000. No human was even needed: another session's stale env downgraded a
  // 1M file the same way. Comparing the file against its own marker is the only
  // question that has an answer stable across a frozen env.
  const peakOwned = fileRaw === undefined || current.peakWritten;
  if (!peakOwned) {
    return { ...base, action: 'skipped', reason: 'not-peaks-owned', tokens: current.tokens };
  }

  const settings = fileSettings ?? {};
  const env = typeof settings.env === 'object' && settings.env !== null && !Array.isArray(settings.env)
    ? (settings.env as Record<string, unknown>)
    : {};
  const next = {
    ...settings,
    // A JSON env block is string-valued. `String(tokens)` is the plain token
    // count the harness documents — never a `500k`-style suffix. The provenance
    // marker is written in the SAME object, so value and provenance can never
    // be split across two writes (see `HARNESS_WINDOW_WRITTEN_KEY`).
    env: {
      ...env,
      [input.location.envVar]: String(input.tokens),
      [HARNESS_WINDOW_WRITTEN_KEY]: String(input.tokens)
    }
  };
  const dir = dirname(settingsPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // 2-space JSON + trailing newline matches the other writer of this file
  // (`.claude/settings.local.json`), so a diff after a sync stays minimal.
  writeFileSync(settingsPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  // `peakWritten` describes the file AFTER this call, and this call is what
  // armed the marker — the pre-write read necessarily said `false`, because a
  // write only happens when the file did not already hold the wanted value
  // under a matching marker.
  return { ...base, action: 'written', tokens: input.tokens, peakWritten: true };
}

/**
 * Rollback: remove the window key and record the opt-out so the next sync
 * does not put it straight back. Both edits land in the same
 * read-modify-write, so there is no window in which the key is gone but the
 * opt-out is not yet on disk.
 *
 * Idempotent: a second call reports `action: 'absent'` and rewrites nothing
 * unless the opt-out row is missing.
 */
export function resetHarnessWindow(input: {
  readonly location: HarnessWindowLocation;
  readonly env?: NodeJS.ProcessEnv | undefined;
}): HarnessWindowResetResult {
  const settingsPath = input.location.settingsPath;
  const settings = readSettingsObject(settingsPath);
  const previousTokens = parseHarnessWindowTokens(envString(settings, input.location.envVar));
  const markerPresent = envString(settings, HARNESS_WINDOW_WRITTEN_KEY) !== undefined;

  if (settings === null || !isEditable(settingsPath)) {
    // Nothing to remove and nothing we can safely edit.
    return { settingsPath, action: 'absent', previousTokens };
  }
  // NOTHING OF PEAKS-LOOP'S TO REMOVE → WRITE NOTHING.
  //
  // The old form short-circuited only when the opt-out was ALREADY recorded
  // (`... && priorOptOut`), so `--reset` on a file peaks-loop had never touched
  // still wrote `PEAKS_HARNESS_WINDOW_SYNC: "off"` into it. When that file is
  // the user's PERSONAL `$HOME/.claude/settings.local.json` — a fresh terminal
  // plus `--project .`, i.e. the ordinary case — the rollback inserted a
  // peaks-loop row into a file with no peaks content at all: litter in the
  // user's own settings, written by the command they ran to REMOVE something.
  //
  // A no-op is the honest outcome. There is no window to remove and no
  // provenance marker to disarm, so there is nothing to make durable; the
  // caller reports `absent` and says that nothing was written. A key the user
  // deletes by hand but whose marker survives still falls through below, so the
  // stale marker is still cleaned up — that is why the test is `markerPresent`
  // and not `!priorOptOut`.
  if (previousTokens === null && !markerPresent) {
    return { settingsPath, action: 'absent', previousTokens };
  }

  const env = typeof settings.env === 'object' && settings.env !== null && !Array.isArray(settings.env)
    ? { ...(settings.env as Record<string, unknown>) }
    : {};
  delete env[input.location.envVar];
  // The provenance marker goes with the value it describes — a marker left
  // behind would claim ownership of whatever the user writes next.
  delete env[HARNESS_WINDOW_WRITTEN_KEY];
  env[HARNESS_WINDOW_SYNC_OPTOUT_KEY] = HARNESS_WINDOW_SYNC_OPTOUT_VALUE;

  const next = { ...settings, env };
  writeFileSync(settingsPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return { settingsPath, action: 'removed', previousTokens };
}

/**
 * Undo the opt-out (the companion of `resetHarnessWindow`) so peaks-loop
 * resumes owning the harness window.
 */
export function reenableHarnessWindowSync(input: {
  readonly location: HarnessWindowLocation;
}): { readonly settingsPath: string; readonly action: 'reenabled' | 'absent' } {
  const settingsPath = input.location.settingsPath;
  const settings = readSettingsObject(settingsPath);
  if (settings === null) return { settingsPath, action: 'absent' };
  const env = typeof settings.env === 'object' && settings.env !== null && !Array.isArray(settings.env)
    ? { ...(settings.env as Record<string, unknown>) }
    : {};
  if (env[HARNESS_WINDOW_SYNC_OPTOUT_KEY] === undefined) return { settingsPath, action: 'absent' };
  delete env[HARNESS_WINDOW_SYNC_OPTOUT_KEY];
  writeFileSync(settingsPath, `${JSON.stringify({ ...settings, env }, null, 2)}\n`, 'utf8');
  return { settingsPath, action: 'reenabled' };
}
