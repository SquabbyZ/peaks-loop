/**
 * Harness auto-compact THRESHOLD percent ownership — the WRITE half.
 *
 * The window module next door answers "how big is the window the harness
 * compacts against". This module answers the other half of when it fires: the
 * harness's own percentage knob (`IdeCompactProfile.autoCompactPercentEnvVar`,
 * declared per adapter — no IDE names here). The read-only verdict lives in
 * `harness-compact-threshold-verdict.ts`.
 *
 * WHY A PERCENT IS NEEDED AT ALL. Measured on Claude Code 2.1.314 (2026-11-20):
 * with no percent set, the harness compacts at `window − 13_000` (≈98.7% of a
 * 1M window) or `window − 20_000` below 200K — after the point long-running
 * sessions already die. With the percent set it compacts at `window × PCT%`.
 * Writing the window alone therefore does NOT make early compaction happen;
 * the pair is the feature.
 *
 * WHAT IS DELIBERATELY SHARED, NOT RE-IMPLEMENTED. The window half is written
 * by `syncHarnessWindow` itself — the only implementation of its provenance
 * guard, its band check, its opt-out and its home-directory guard. A second copy
 * here would eventually disagree with the first about some file, so this module
 * calls it and reports its result. What IS new is the percent key: its parse,
 * its band, its own provenance marker, and one read-modify-write that touches
 * nothing else in the file.
 *
 * THE PAIR IS TWO SEPARATE WRITES, AND THE FIRST ONE CAN OUTLIVE THE SECOND. A
 * failure between them does NOT restore "the pre-slice state" — the window half
 * has already been written by then, and only the percent half is missing. That
 * is deliberate: each half is idempotent and independently owned, so a later
 * init (or probe) fills the percent without re-deriving the window, and a percent
 * refusal never rolls back a window that was correct on its own.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { getAdapter } from '../ide/ide-registry.js';
import type { IdeId } from '../ide/ide-types.js';
import { detectIdeFromEnv } from './ide-detect.js';
import type { HarnessWindowLocation } from './harness-window-config.js';
import { envBlock, readSettingsObject, settingsEnvValue } from './harness-settings-file.js';
import { percentSkipReason, SKIP_UNCHANGED } from './harness-percent-gates.js';
import {
  HARNESS_PERCENT_WRITTEN_KEY,
  boundedRawNote,
  isHarnessPercentPeaksOwned,
  parseHarnessCompactPercent,
  percentOwnershipOf,
  type HarnessPercentOwnership
} from './harness-percent-ownership.js';

/**
 * The window peaks-loop configures when nobody has said otherwise.
 *
 * 1_000_000 is the harness's accepted MAXIMUM (band 100_000..1_000_000), and
 * that is why it is the neutral default: the harness CLAMPS the window to the
 * model's own context, so the maximum means "as much as this model holds".
 * Measured 2026-11-22: a 1M model gets effectiveWindow 980_000 → threshold
 * 800_000; a 200K model given the same window is clamped to 180_000 → 160_000.
 * The old 250_000 default capped a 1M model at 25% and fired at 200_000. A
 * fresh project gets THIS rather than an unset slot ("no early compaction").
 */
export const DEFAULT_HARNESS_COMPACT_WINDOW_TOKENS = 1_000_000;

/**
 * The percent peaks-loop configures when nobody has said otherwise — 80% of
 * the window above, i.e. an 800_000-token trigger on the 1_000_000 default.
 *
 * The single named default, exported here and nowhere else.
 */
export const DEFAULT_HARNESS_COMPACT_PERCENT = 80;

/**
 * The ownership half — parse, band, marker predicate, five-state classifier and
 * the state read — lives in `harness-percent-ownership.ts` and is RE-EXPORTED
 * here so every existing import path in this slice keeps working. It is its own
 * module so the writer, the rollback and the state report cannot grow three
 * spellings of "is this value peaks-loop's", and so both of those files stay
 * under the file-size cap.
 */
export type { HarnessPercentOwnership, HarnessPercentState } from './harness-percent-ownership.js';
export {
  HARNESS_COMPACT_PERCENT_MAX,
  HARNESS_COMPACT_PERCENT_MIN,
  HARNESS_PERCENT_WRITTEN_KEY,
  isHarnessPercentPeaksOwned,
  isHarnessPercentRemovable,
  parseHarnessCompactPercent,
  percentOwnershipOf,
  readHarnessPercentState
} from './harness-percent-ownership.js';

/** A location that carries BOTH adapter-declared keys. */
export interface HarnessCompactThresholdLocation extends HarnessWindowLocation {
  /** Env var / settings key the harness reads its auto-compact percent from. */
  readonly percentEnvVar: string;
}

/**
 * Resolve where the pair lives, for the IDE the env selects. `null` when any
 * half is undeclared — the adapter names both keys and the file, never this
 * module.
 *
 * It repeats the three-line adapter lookup rather than importing
 * `resolveHarnessWindowLocation` (whose result it would only widen with the
 * percent key) for one reason: that helper lives next door in
 * `auto-compact-reader.ts`, which is the probe entry point and pulls in the
 * statusline / transcript fallbacks. Keeping the write half off that import
 * keeps a settings write from loading the whole probe stack — it is a
 * dependency-weight decision, not a correctness one, and there is no import
 * cycle either way.
 */
export function resolveHarnessCompactThresholdLocation(input: {
  readonly projectRoot: string;
  readonly env?: NodeJS.ProcessEnv | undefined;
}): HarnessCompactThresholdLocation | null {
  const env = input.env ?? process.env;
  const detected = detectIdeFromEnv(env);
  const ideId: IdeId = (detected === 'unknown' ? 'claude-code' : detected) as IdeId;
  const adapter = getAdapter(ideId);
  const windowEnvVar = adapter.compact?.autoCompactWindowEnvVar;
  const percentEnvVar = adapter.compact?.autoCompactPercentEnvVar;
  const fileName = adapter.settings.localSettingsFileName ?? adapter.settings.settingsFileName;
  if (windowEnvVar === undefined || percentEnvVar === undefined || fileName === undefined)
    return null;
  return {
    settingsPath: join(input.projectRoot, adapter.settings.dirName, fileName),
    envVar: windowEnvVar,
    percentEnvVar,
    projectRoot: input.projectRoot
  };
}

/**
 * The shared settings-file read layer, re-exported so every existing import
 * path in this slice's own modules keeps working. The implementation lives in
 * `harness-settings-file.ts`; see its header for why it is one copy.
 */
export type { SettingsFileShape } from './harness-settings-file.js';
export {
  envBlock,
  isEditableSettingsFile,
  isLinkedSettingsFile,
  readSettingsObject,
  settingsEnvValue
} from './harness-settings-file.js';

export type HarnessPercentSyncAction = 'written' | 'unchanged' | 'skipped';

export interface HarnessPercentSyncResult {
  readonly settingsPath: string;
  readonly key: string;
  readonly action: HarnessPercentSyncAction;
  /**
   * Why nothing was written, present only for `skipped`:
   *   - `opted-out`           — the project's rollback flag is set (it covers
   *                             both knobs: "remove it" must not be undone by a
   *                             percent row appearing later)
   *   - `unsafe-project-root` — the root IS the user's home directory
   *   - `no-percent-resolved` — the caller passed `null` explicitly
   *   - `unreadable-percent`  — the FILE's value is not a percentage at all,
   *                             so no threshold can be read from it
   *   - `out-of-range`        — not a whole 1..100, refused rather than clamped
   *   - `unreadable-settings` — the file is not a JSON object we can edit
   *   - `symlinked-settings`  — the file, or the `.claude` directory holding it,
   *                             is a symlink or junction, so writing would
   *                             follow it into whatever it points at.
   *                             Its own reason rather than `unreadable-settings`:
   *                             the file may parse perfectly, and telling the
   *                             user it is "not a JSON object" would point at
   *                             the wrong remedy.
   *   - `not-peaks-owned`     — the file holds a percent peaks-loop did not
   *                             write (a human's pin), never overwritten
   */
  readonly reason?: string;
  /**
   * True only on the `written` action.
   *
   * Why it travels: the RESET sentence cannot tell "wrote (cleaned a stale
   * marker)" from "wrote nothing" by looking at what was removed — a stale
   * percent marker leaves nothing to name while the rollback still wrote the
   * opt-out. A result that says whether THIS call wrote is the one fact that
   * distinguishes them, so it is reported rather than re-derived.
   */
  readonly wrote: boolean;
  readonly percent: number | null;
  /**
   * The percent the caller ASKED for, on every branch — mirroring
   * `requestedTokens` on the window result.
   *
   * Why it is carried rather than left at the call site: on the skip path
   * `percent` is the value the FILE holds, so an out-of-band refusal rendered
   * `null is outside the 1..100 percent` — a sentence naming nothing. A refusal
   * takes two values (what was asked, what the band is) and only the result can
   * name the first.
   */
  readonly requestedPercent: number | null;
  readonly previousPercent: number | null;
  /**
   * A BOUNDED description of the file's value before the call (MED-2), present
   * only when the file carried the key — never the raw string, not a prefix.
   *
   * `previousPercent` cannot express the case that matters: a hand-typed
   * `eighty` parses to `null`, exactly like an absent key, yet the two need
   * opposite notices. The note's presence is that distinction, without putting
   * user-writable text on a result that reaches logs.
   */
  readonly previousRawNote?: string;
  /**
   * WHO the file's percent belongs to — the same five-state classifier
   * `--reset` uses. Carried because the refusal notice picks its REMEDY from it:
   * a peaks-owned typo is cleared by `--reset`, while a human's `150` is the
   * user's to change and `--reset` deliberately keeps it, so pointing at that
   * command would be advice the rollback refuses to carry out.
   */
  readonly ownership: HarnessPercentOwnership;
  readonly peakWritten: boolean;
}

/**
 * Write `percent` as the harness's auto-compact threshold percentage.
 * Idempotent: a re-run with the same value performs no write.
 *
 * Everything else in the file is preserved verbatim — this is a
 * read-modify-write of the `env` block only, and only of its two peaks rows.
 *
 * No `env` parameter, deliberately: unlike the WINDOW (whose env copy is what a
 * running session captured and therefore a legitimate source), the percent write
 * has nothing to learn from the process env — it writes the number it was given
 * and judges ownership from the FILE. Accepting an env it never read would be a
 * second, silently-ignored input.
 */
export function syncHarnessPercent(input: {
  readonly location: HarnessCompactThresholdLocation;
  readonly percent: number | null;
}): HarnessPercentSyncResult {
  const settingsPath = input.location.settingsPath;
  const settings = readSettingsObject(settingsPath);
  const fileRaw = settingsEnvValue(settings, input.location.percentEnvVar);
  const markerRaw = settingsEnvValue(settings, HARNESS_PERCENT_WRITTEN_KEY);
  const filePercent = parseHarnessCompactPercent(fileRaw);
  // THE writer's (strict) predicate. NOT the rollback's wider one: a probe may
  // overwrite only a value that still parses to its own marker, so a human's
  // unreadable pin is never silently replaced. See `isHarnessPercentRemovable`.
  const peakWritten = isHarnessPercentPeaksOwned({ fileRaw, markerRaw });
  const ownership = percentOwnershipOf({ fileRaw, markerRaw });
  const base = {
    settingsPath,
    key: input.location.percentEnvVar,
    requestedPercent: input.percent,
    previousPercent: filePercent,
    // Bounded at the source (MED-2): the raw text never leaves this module,
    // and the note's presence is what says the slot was not empty.
    ...(fileRaw === undefined ? {} : { previousRawNote: boundedRawNote(fileRaw) }),
    ownership,
    peakWritten,
    wrote: false
  };
  const skip = percentSkipReason({
    location: input.location,
    percent: input.percent,
    settings,
    fileRaw,
    filePercent,
    peakWritten
  });
  if (skip === SKIP_UNCHANGED) {
    return { ...base, action: 'unchanged', percent: input.percent };
  }
  if (skip !== null) {
    return { ...base, action: 'skipped', reason: skip, percent: filePercent };
  }

  // N8 — A NON-OBJECT `env` BLOCK IS REPLACED, NOT PRESERVED. `envBlock` yields
  // `{}` for a `env` that is absent, `null`, an array or a string, so a file
  // carrying `"env": "oops"` comes out of this write with a fresh object holding
  // only the two peaks rows. That is deliberate: there is no peaks row to find in
  // a value that is not an object, so the alternative is refusing every percent
  // write on that file forever — and the harness itself cannot read a non-object
  // `env`, so no user setting is destroyed by replacing it. The rest of the file
  // (every other top-level key) is still carried over verbatim.
  const next = {
    ...(settings ?? {}),
    env: {
      ...envBlock(settings),
      // A JSON env block is string-valued. `String(percent)` is the plain
      // decimal the parser reads back (`PLAIN_PERCENT_SPELLING`), never `80.0`
      // or `8e1`. The provenance marker travels in the SAME object, so value and
      // provenance can never be split across two writes.
      [input.location.percentEnvVar]: String(input.percent),
      [HARNESS_PERCENT_WRITTEN_KEY]: String(input.percent)
    }
  };
  const dir = dirname(settingsPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // 2-space JSON + trailing newline, the same convention as the window writer.
  writeFileSync(settingsPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return { ...base, action: 'written', percent: input.percent, peakWritten: true, wrote: true };
}
