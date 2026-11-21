/**
 * The OPT-OUT half of the harness window — `--disable` and `--reenable`.
 *
 * Split out of `harness-window-config.ts`, whose excess over the raw-line cap is
 * gated: these two verbs are the only writers of the opt-out ROW, and both carry
 * the link guard (a write through a symlink lands in the victim), so the pair is
 * kept together. Nothing here is vendor-specific, and the only window-side
 * helpers it needs are the reader, the marker constant and the shared
 * `isEditable` predicate — all re-imported, never re-implemented.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { isUserHomeProjectRoot } from '../config/config-safety.js';
import {
  HARNESS_WINDOW_MAX_TOKENS,
  HARNESS_WINDOW_MIN_TOKENS,
  HARNESS_WINDOW_SYNC_OPTOUT_KEY,
  HARNESS_WINDOW_SYNC_OPTOUT_VALUE,
  type HarnessWindowLocation,
  type HarnessWindowSyncResult
} from './harness-window-config.js';
// The shared settings-file layer: one spelling of 'is this a link' and 'is this
// editable', never a second copy here.
import {
  isEditableSettingsFile,
  isLinkedSettingsFile,
  readSettingsObject
} from './harness-settings-file.js';

/**
 * The WHERE guards for a write of the opt-out row, in order, or `null` when the
 * write may proceed. Shared by `--disable` and `--reenable`: both edit the same
 * file, so both refuse the same placements. Home FIRST — a refusal that has
 * already mkdir'd `$HOME/.claude` is not a refusal — then the link, before the
 * editability test, because a symlinked file (or a linked `.claude` directory
 * above an ordinary one) parses fine and the write would follow it into the victim.
 */
function optOutRefusal(
  location: HarnessWindowLocation
): 'refused-unsafe-project-root' | 'symlinked-settings' | 'unreadable-settings' | null {
  if (location.projectRoot !== undefined && isUserHomeProjectRoot(location.projectRoot)) {
    return 'refused-unsafe-project-root';
  }
  if (isLinkedSettingsFile(location.settingsPath)) return 'symlinked-settings';
  if (!isEditableSettingsFile(location.settingsPath)) return 'unreadable-settings';
  return null;
}

/**
 * Record the opt-out WITHOUT removing anything: "stop managing this key",
 * expressible at any moment — including before peaks-loop has ever written it.
 *
 * WHY THIS IS A SEPARATE ENTRY POINT, NOT A FALLBACK OF `resetHarnessWindow`.
 * `--reset` on a file holding no peaks row is deliberately a no-op, so a project
 * peaks-loop never touched had no command for the second intention; folding it
 * into `--reset` would make one verb mean "delete" or "don't write" depending on
 * whether a row happened to exist. Two verbs, two predictable intentions.
 *
 * WHAT IT DOES NOT DO: it does not touch the window key (a hand-set value stays,
 * as the B1 guard would keep it anyway) and writes no provenance marker, so it
 * claims no ownership. The next probe reports `skipped / opted-out`.
 *
 * Idempotent: a second call reports `already-opted-out` and rewrites nothing.
 */
export function disableHarnessWindowSync(input: { readonly location: HarnessWindowLocation }): {
  readonly settingsPath: string;
  readonly action:
    | 'disabled'
    | 'already-opted-out'
    | 'unreadable-settings'
    | 'refused-unsafe-project-root'
    | 'symlinked-settings';
} {
  const settingsPath = input.location.settingsPath;
  const refusal = optOutRefusal(input.location);
  if (refusal !== null) return { settingsPath, action: refusal };
  const settings = readSettingsObject(settingsPath);
  const env =
    typeof settings?.env === 'object' && settings.env !== null && !Array.isArray(settings.env)
      ? { ...settings.env }
      : {};
  if (env[HARNESS_WINDOW_SYNC_OPTOUT_KEY] === HARNESS_WINDOW_SYNC_OPTOUT_VALUE) {
    return { settingsPath, action: 'already-opted-out' };
  }
  env[HARNESS_WINDOW_SYNC_OPTOUT_KEY] = HARNESS_WINDOW_SYNC_OPTOUT_VALUE;
  const dir = dirname(settingsPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify({ ...(settings ?? {}), env }, null, 2)}\n`, 'utf8');
  return { settingsPath, action: 'disabled' };
}

/**
 * Undo the opt-out (the companion of `resetHarnessWindow`) so peaks-loop
 * resumes owning the harness window.
 *
 * It WRITES, so the same WHERE guards as `--disable` fire: at `$HOME` it would
 * edit the user's personal settings, and through a link it would edit the
 * victim. Both are reported, never thrown.
 */
export function reenableHarnessWindowSync(input: { readonly location: HarnessWindowLocation }): {
  readonly settingsPath: string;
  readonly action: 'reenabled' | 'absent' | 'refused-unsafe-project-root' | 'symlinked-settings';
} {
  const settingsPath = input.location.settingsPath;
  const refusal = optOutRefusal(input.location);
  // `unreadable-settings` is the one opt-out refusal `--reenable` reports as
  // `absent`: there is no opt-out it can see, and it writes nothing either way.
  if (refusal === 'refused-unsafe-project-root' || refusal === 'symlinked-settings') {
    return { settingsPath, action: refusal };
  }
  if (refusal === 'unreadable-settings') return { settingsPath, action: 'absent' };
  const settings = readSettingsObject(settingsPath);
  if (settings === null) return { settingsPath, action: 'absent' };
  const env =
    typeof settings.env === 'object' && settings.env !== null && !Array.isArray(settings.env)
      ? { ...settings.env }
      : {};
  if (env[HARNESS_WINDOW_SYNC_OPTOUT_KEY] === undefined) return { settingsPath, action: 'absent' };
  delete env[HARNESS_WINDOW_SYNC_OPTOUT_KEY];
  writeFileSync(settingsPath, `${JSON.stringify({ ...settings, env }, null, 2)}\n`, 'utf8');
  return { settingsPath, action: 'reenabled' };
}

// ---- the window NOTICES, moved out of the over-cap config module -------

/** The band, in the ONE spelling every refusal and suppression quotes. */
function harnessWindowBand(): string {
  return `${HARNESS_WINDOW_MIN_TOKENS}..${HARNESS_WINDOW_MAX_TOKENS}`;
}

/**
 * The ONE wording of "what the harness-window sync just did", for both commands
 * that sync (`context-now`, `auto-compact`). ONE definition, so a future edit
 * cannot tell half the users — see 要告知 in the module header.
 *
 * The `written` branch names the key, value, file, previous value and the exact
 * rollback, because the harness reports its override only through
 * `/autocompact`. The `skipped` branch is composed from the reason, the two
 * numbers when they disagree, and the raw value when the file's value is not a
 * number — see `harnessWindowConflictClause` / `unreadableWindowValueClause`.
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
  // E1: the resolved window is not one the harness accepts, so this ratio's
  // denominator is un-anchored no matter what the file holds. Reported FIRST —
  // it is the more fundamental disagreement, and the two clauses below would
  // read as "a different number" rather than "a number the harness cannot use".
  if (result.reason === 'out-of-harness-range') {
    return `harness window out of range: this probe divided by ${String(result.requestedTokens)} tokens, outside the ${harnessWindowBand()} band the harness accepts — the ratio does not describe the harness's own trigger`;
  }
  if (
    result.requestedTokens !== null &&
    result.previousTokens !== null &&
    result.requestedTokens !== result.previousTokens
  ) {
    return `harness window conflict: this probe divided by ${result.requestedTokens} tokens but ${result.settingsPath} pins ${result.previousTokens} — the ratio does not describe the harness's own trigger`;
  }
  if (result.previousTokens === null && result.previousRawNote !== undefined) {
    return `harness window unreadable: ${result.settingsPath} carries ${result.previousRawNote}, which is not a plain token count`;
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
    case 'out-of-harness-range':
      return `Harness window not managed: the window this probe resolved (${String(result.requestedTokens)}) is outside the ${harnessWindowBand()} band the harness accepts, so writing it would put a number in ${result.settingsPath} that the harness does not compact on.`;
    case 'unreadable-settings':
      return `Harness window not managed: ${result.settingsPath} is not a JSON object peaks-loop can safely edit, so it was left exactly as found.`;
    case 'symlinked-settings':
      return `Harness window not managed: ${result.settingsPath} is a symlink (or a Windows junction), or the directory holding it is, so writing would follow the link and overwrite the file it points at. Replace the link with a real file (or directory) and the window lands here.`;
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
  if (result.action !== 'skipped' || requested === null || pinned === null || requested === pinned)
    return '';
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
  if (
    result.action !== 'skipped' ||
    result.previousTokens !== null ||
    result.previousRawNote === undefined
  )
    return '';
  const raw = result.previousRawNote;
  return ` The value in ${result.settingsPath} is ${raw}, which is not a plain token count: peaks-loop cannot read a window from it, so it resolved this ratio against its own fallback while the file keeps claiming a window it cannot parse. peaks-loop cannot align the two without overwriting a value it did not write — set the value to a plain token count, or run \`peaks compact harness-window --reset\` to remove the key and let the next probe write peaks-loop's number.`;
}
