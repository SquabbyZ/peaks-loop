/**
 * The harness settings file, as a JSON object — the small shared read layer the
 * threshold modules sit on.
 *
 * Why it is its own module: three of them (`-config`, `-verdict`, `-reset`) read
 * the same file and must answer "cannot read it" identically. One copy here is
 * what keeps a fourth reader from disagreeing about a corrupt file, and it is
 * also what keeps each of those modules under the file-size cap.
 *
 * The READER is not a second copy. `readSettingsObject` and its shape already
 * live in `harness-window-config.ts`, which had to answer the same question for
 * the window sync; this module re-exports that one implementation so a corrupt
 * file cannot be "readable" to one caller and "unreadable" to another. The
 * helpers below are the threshold-specific view of it.
 *
 * Vendor neutrality: this knows about a JSON file with an `env` block and
 * nothing else. The path and every key name are the caller's.
 */

import { existsSync } from 'node:fs';

import { readSettingsObject, type SettingsFileShape } from './harness-window-config.js';

export { readSettingsObject };
export type { SettingsFileShape };

/**
 * True when the settings path, or the DIRECTORY holding it, is a LINK (a
 * symlink, or on Windows a junction — `lstat` reports both as
 * `isSymbolicLink()`), which none of this slice's writers may write through.
 *
 * RE-EXPORTED, not re-implemented, from `../ide/shared/safe-path.ts` — the
 * module that already owns settings-path safety (`assertSafeSettingsFile`) — so
 * there is one spelling of "what is a link" and every threshold module reaches
 * it through here, with no import cycle. See that module for why the directory
 * is checked as well as the file, and why an absent path still counts as
 * writable.
 */
export { isLinkedSettingsFile } from '../ide/shared/safe-path.js';

/**
 * True when the file is absent (editable) or a parseable JSON object.
 *
 * Exported because the reset path has to ask the same question before it
 * decides a file is "unreadable and therefore untouchable" rather than
 * "carrying nothing of peaks-loop's".
 */
export function isEditableSettingsFile(settingsPath: string): boolean {
  if (!existsSync(settingsPath)) return true;
  return readSettingsObject(settingsPath) !== null;
}

/** The `env` object of a parsed settings file, or `{}` — never a shared reference. */
export function envBlock(settings: SettingsFileShape | null): Record<string, unknown> {
  const env = settings?.env;
  return typeof env === 'object' && env !== null && !Array.isArray(env) ? env : {};
}

/** One key out of a parsed settings file's `env` block; `undefined` when absent. */
export function settingsEnvValue(settings: SettingsFileShape | null, key: string): unknown {
  return envBlock(settings)[key];
}

/** `was X` for a value that was there, nothing when it was not. */
export function wasValue(value: number | null): string {
  return value === null ? '' : ` (was ${String(value)})`;
}

/**
 * The MED-2 bounded vocabulary (see `harness-percent-ownership.ts`), re-exported
 * so every caller reaches it through one path.
 *
 * THE INVARIANT IS STRUCTURAL, NOT A MAPPER'S JOB. Every service-layer result in
 * this slice that can carry text read from the settings file carries a bounded
 * NOTE (`previousRawNote` / `rawNote` / `windowRawNote` …) computed where the
 * value is read. A result that never holds the plaintext cannot leak it,
 * whichever consumer logs or persists it.
 */
export { isPlainIntegerSpelling, boundedRawNote } from './harness-percent-ownership.js';

/**
 * How a removed percent half is named — the number when it was one, and a
 * fixed BOUNDED phrase (never the raw string, MED-2) when it was not.
 */
export function percentClause(percent: {
  readonly key: string;
  readonly ownership: string;
  readonly previousPercent: number | null;
}): string {
  return percent.ownership === 'peaks-corrupt'
    ? `${percent.key} (held a value that is not a percentage, not echoed here)`
    : `${percent.key}${wasValue(percent.previousPercent)}`;
}

/** The one sentence for a rollback that found nothing of peaks-loop's. */
export function nothingToRemoveSentence(
  settingsPath: string,
  windowKey: string,
  percentKey: string
): string {
  return `Nothing to remove — ${settingsPath} carries no ${windowKey}, no ${percentKey}, and no provenance marker peaks-loop wrote, so nothing was written and no opt-out row was recorded.`;
}
