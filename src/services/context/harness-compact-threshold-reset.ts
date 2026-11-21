/**
 * Harness auto-compact THRESHOLD — the ROLLBACK half.
 *
 * `peaks compact harness-window --reset` must undo the PAIR: removing only the
 * window left `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` (and its marker) behind, moving
 * the trigger EARLIER while the opt-out row claimed nothing was managed.
 * It is NOT a second call to `resetHarnessWindow`, whose no-op guard fires when
 * the file holds no WINDOW row — exactly the state a percent can be left in
 * alone. One read-modify-write deciding BOTH ownership questions is the only
 * shape in which "removed the window but not the percent" cannot exist on disk.
 *
 * BOTH HALVES OBEY AN OWNERSHIP RULE, and it is the rollback's WIDER one
 * (`percentOwnershipOf` / `windowOwnershipOf`): the init notice for a peaks-owned
 * typo says "`--reset` to clear it", and a rule requiring both sides to parse
 * would refuse exactly that value — a VALID numeric marker beside an unreadable
 * value is peaks-loop's own write corrupted afterwards. A value with NO marker,
 * or with an UNPARSEABLE marker (peaks-loop never writes one), is the user's own
 * pin, and `--reset` undoes what peaks-loop wrote, never the user's own config.
 */

import { existsSync, writeFileSync } from 'node:fs';

import {
  envBlock,
  parseHarnessCompactPercent,
  percentOwnershipOf,
  readSettingsObject,
  HARNESS_PERCENT_WRITTEN_KEY,
  type HarnessCompactThresholdLocation,
  type HarnessPercentOwnership
} from './harness-compact-threshold-config.js';
// The TYPES live in their own module; see .
import {
  HARNESS_WINDOW_SYNC_OPTOUT_KEY,
  HARNESS_WINDOW_SYNC_OPTOUT_VALUE,
  HARNESS_WINDOW_WRITTEN_KEY,
  isLinkedSettingsFile,
  parseHarnessWindowTokens
} from './harness-window-config.js';
import { windowOwnershipOf, type HarnessWindowOwnership } from './harness-window-ownership.js';
import {
  boundedRawNote,
  nothingToRemoveSentence,
  percentClause,
  wasValue
} from './harness-settings-file.js';
import type {
  HarnessThresholdResetKnobAction,
  HarnessThresholdResetRefusal,
  HarnessThresholdResetResult
} from './harness-compact-threshold-reset-types.js';

// Re-exported so every existing import path stays put.
export type {
  HarnessPercentOwnership,
  HarnessThresholdResetKnobAction,
  HarnessThresholdResetRefusal,
  HarnessThresholdResetResult,
  HarnessWindowOwnership
} from './harness-compact-threshold-reset-types.js';

/** The action a given ownership state produces. */
function actionOf(
  ownership: HarnessPercentOwnership | HarnessWindowOwnership
): HarnessThresholdResetKnobAction {
  if (ownership === 'peaks' || ownership === 'peaks-corrupt') return 'removed';
  return ownership === 'human' ? 'kept-human' : 'absent';
}

/** Everything `--reset` found, before deciding whether to write. */
interface ThresholdSnapshot {
  readonly settingsPath: string;
  readonly windowKey: string;
  readonly percentKey: string;
  readonly settings: ReturnType<typeof readSettingsObject>;
  readonly env: Record<string, unknown>;
  readonly previousTokens: number | null;
  readonly windowRaw: unknown;
  readonly filePercent: number | null;
  readonly ownership: HarnessPercentOwnership;
  readonly windowOwnership: HarnessWindowOwnership;
}

function snapshotOf(location: HarnessCompactThresholdLocation): ThresholdSnapshot {
  const settingsPath = location.settingsPath;
  const settings = existsSync(settingsPath) ? readSettingsObject(settingsPath) : null;
  const env = envBlock(settings);
  const windowRaw = env[location.envVar];
  const windowMarkerRaw = env[HARNESS_WINDOW_WRITTEN_KEY];
  const percentRaw = env[location.percentEnvVar];
  return {
    settingsPath,
    windowKey: location.envVar,
    percentKey: location.percentEnvVar,
    settings,
    env,
    previousTokens: parseHarnessWindowTokens(windowRaw),
    windowRaw,
    filePercent: parseHarnessCompactPercent(percentRaw),
    ownership: percentOwnershipOf({
      fileRaw: percentRaw,
      markerRaw: env[HARNESS_PERCENT_WRITTEN_KEY]
    }),
    // The SAME rule the percent half uses, asked of the window pair: a value
    // with no marker is the user's own pin, so the rollback keeps it.
    windowOwnership: windowOwnershipOf({ fileRaw: windowRaw, markerRaw: windowMarkerRaw })
  };
}
/** True when the file's opt-out row is already in place. */
function readsOptedOut(env: Record<string, unknown>): boolean {
  return env[HARNESS_WINDOW_SYNC_OPTOUT_KEY] === HARNESS_WINDOW_SYNC_OPTOUT_VALUE;
}

/**
 * Remove what peaks-loop wrote for BOTH knobs and record the opt-out, in one
 * read-modify-write.
 *
 * A file with no peaks row of any kind is left byte-identical (the `$HOME`
 * litter guard): there is nothing to roll back and nothing to make durable.
 * A file whose only peak is a HUMAN window pin or a HUMAN percent still gets the
 * opt-out row written, because those values ARE the harness threshold's content
 * — the rollback's job is to stop peaks-loop managing it, and the sync would
 * otherwise overwrite/fill the other knob on the next probe. The human's own
 * value is never touched; only its ownership of it is left to the user.
 *
 * No `env` parameter, deliberately — mirrors `syncHarnessPercent`. Ownership is
 * a property of the FILE against its own marker; the process env is frozen at
 * session start and would be a second, silently-ignored input.
 */
export function resetHarnessThreshold(input: {
  readonly thresholdLocation: HarnessCompactThresholdLocation;
}): HarnessThresholdResetResult {
  const snap = snapshotOf(input.thresholdLocation);
  // Refused in order: a LINK must not be written through, then an EXISTING file
  // that will not parse cannot be edited. Both are REPORTED, never thrown — an
  // init or probe that reaches this must learn why nothing happened, not crash.
  // An ABSENT file is neither: it carries nothing of peaks-loop's, so it falls
  // through to the no-op below with the literal (absent, no opt-out) result.
  if (isLinkedSettingsFile(snap.settingsPath)) return resultOf(snap, false, 'symlinked-settings');
  if (snap.settings === null && existsSync(snap.settingsPath)) {
    return resultOf(snap, false, 'unreadable-settings');
  }
  // Nothing of peaks-loop's to remove → write nothing. A stale marker (of either
  // knob) IS peaks content and falls through, so it gets cleaned up. A HUMAN
  // value alone also falls through: the opt-out must cover the knobs the user
  // genuinely set, or the next probe fills the other one behind their back.
  if (nothingToRemove(snap)) return resultOf(snap, readsOptedOut(snap.env));

  writeThresholdReset(snap, input.thresholdLocation);
  return resultOf(snap, true, undefined, true);
}

/** True when neither knob holds a value at all — the pure no-op. */
function nothingToRemove(snap: ThresholdSnapshot): boolean {
  return snap.windowOwnership === 'none' && snap.ownership === 'none';
}

/**
 * The single write. Each knob's rows are deleted only when the value is
 * peaks-loop's own; a human's value and its (mismatching) marker stay together,
 * because a marker that no longer matches its value IS the evidence of takeover.
 */
function writeThresholdReset(
  snap: ThresholdSnapshot,
  location: HarnessCompactThresholdLocation
): void {
  const nextEnv = { ...snap.env };
  // A `stale-marker` window has no value to delete, only the marker to clean.
  if (snap.windowOwnership === 'peaks' || snap.windowOwnership === 'peaks-corrupt') {
    delete nextEnv[location.envVar];
    delete nextEnv[HARNESS_WINDOW_WRITTEN_KEY];
  } else if (snap.windowOwnership === 'stale-marker') {
    delete nextEnv[HARNESS_WINDOW_WRITTEN_KEY];
  }
  const removable = snap.ownership === 'peaks' || snap.ownership === 'peaks-corrupt';
  if (removable || snap.ownership === 'stale-marker') delete nextEnv[HARNESS_PERCENT_WRITTEN_KEY];
  if (removable) delete nextEnv[location.percentEnvVar];
  nextEnv[HARNESS_WINDOW_SYNC_OPTOUT_KEY] = HARNESS_WINDOW_SYNC_OPTOUT_VALUE;
  writeFileSync(
    snap.settingsPath,
    `${JSON.stringify({ ...(snap.settings ?? {}), env: nextEnv }, null, 2)}\n`,
    'utf8'
  );
}

/** The result shape, built from the PRE-write snapshot plus the opt-out after. */
function resultOf(
  snap: ThresholdSnapshot,
  optedOut: boolean,
  refusal?: HarnessThresholdResetRefusal,
  wrote = false
): HarnessThresholdResetResult {
  const base = {
    settingsPath: snap.settingsPath,
    window: {
      key: snap.windowKey,
      action: actionOf(snap.windowOwnership),
      ownership: snap.windowOwnership,
      previousTokens: snap.previousTokens,
      // Bounded at the source (MED-2).
      ...(snap.windowRaw === undefined ? {} : { previousRawNote: boundedRawNote(snap.windowRaw) })
    },
    percent: {
      key: snap.percentKey,
      action: actionOf(snap.ownership),
      ownership: snap.ownership,
      previousPercent: snap.filePercent,
      ...(snap.env[snap.percentKey] === undefined
        ? {}
        : { previousRawNote: boundedRawNote(snap.env[snap.percentKey]) })
    },
    optedOut,
    wrote
  };
  // Spread rather than `refusal: undefined`, so `exactOptionalPropertyTypes`
  // keeps the property ABSENT on the ordinary (wrote / nothing-to-remove) paths.
  return refusal === undefined ? base : { ...base, refusal };
}

/**
 * What the rollback did, in one sentence — the half it deliberately KEPT
 * included ("Removed the threshold" would be false when a human's percent
 * survived). A CORRUPTED peaks-owned value (`peaks-corrupt`) is reported as
 * REMOVED, never `kept-human`: the user did not set it.
 */
export function describeHarnessThresholdReset(result: HarnessThresholdResetResult): string {
  const { window, percent, settingsPath } = result;
  // A REFUSAL IS ITS OWN SENTENCE, so no other branch can be printed about a
  // file this call declined to touch.
  if (result.refusal !== undefined) {
    return describeResetRefusal(result.refusal, settingsPath, window.key, percent.key);
  }
  const kept = [keptClause(window), keptClause(percent, true)].filter(Boolean).join('');
  // A GENUINE NO-OP IS DECIDED BY `wrote`, NOT BY THE REMOVALS: a stale percent
  // marker leaves nothing to name while the file DID change. A HUMAN pin is
  // still named — "nothing to remove" about the user's own window must not read
  // as "there was no setting here".
  if (!result.wrote) {
    return `${nothingToRemoveSentence(settingsPath, window.key, percent.key)}${kept}`;
  }
  const removed = [
    ...(window.action === 'removed' ? [`${window.key}${wasValue(window.previousTokens)}`] : []),
    ...(percent.action === 'removed' ? [percentClause(percent)] : [])
  ];
  // Three write shapes, and the sentence names the RIGHT one: removals → name
  // them; only a stale marker cleaned → say THAT; neither → only HUMAN values
  // were found and the write is the opt-out row itself.
  const what =
    removed.length > 0
      ? `Removed ${removed.join(' and ')} from ${settingsPath}`
      : staleMarkerCleaned(window, percent)
        ? `Cleaned the stale peaks-loop provenance marker from ${settingsPath}`
        : `Peaks-loop now leaves ${window.key} and ${percent.key} alone in ${settingsPath}`;
  return `${what} and opted this project out, so later probes and installs stop writing either knob.${kept} Undo with \`peaks compact harness-window --reenable\`.`;
}

/** True when the ONLY thing this call cleaned was a marker with no value. */
function staleMarkerCleaned(
  window: HarnessThresholdResetResult['window'],
  percent: HarnessThresholdResetResult['percent']
): boolean {
  return window.ownership === 'stale-marker' || percent.ownership === 'stale-marker';
}
/**
 * The `Kept …` clause for one knob whose value survived because it is the
 * user's own. Empty for every other action, so the two halves share one wording
 * and a kept window cannot go unreported while a kept percent is announced.
 */
function keptClause(
  knob: {
    readonly key: string;
    readonly action: HarnessThresholdResetKnobAction;
    readonly previousRawNote?: string;
  },
  percent = false
): string {
  if (knob.action !== 'kept-human') return '';
  const what = percent
    ? 'which is your own setting rather than a value peaks-loop wrote'
    : 'which is your own value rather than one peaks-loop wrote';
  // The note is bounded at its source (MED-2) — this reaches stdout and logs.
  return ` Kept ${knob.key}=${knob.previousRawNote ?? 'a value'}, ${what}.`;
}

/**
 * The sentence for a rollback that declined to write — one clause per reason, so
 * a refusal never degrades to a bare token and never claims a write.
 */
function describeResetRefusal(
  refusal: HarnessThresholdResetRefusal,
  settingsPath: string,
  windowKey: string,
  percentKey: string
): string {
  if (refusal === 'symlinked-settings') {
    return `Nothing written — ${settingsPath} is a symlink (or a Windows junction), or the directory holding it is, so removing ${windowKey} or ${percentKey} would follow the link and overwrite the file it points at. Replace the link with a real file (or directory) and re-run.`;
  }
  return `Nothing written — ${settingsPath} is not a JSON object peaks-loop can safely edit, so ${windowKey} and ${percentKey} were left exactly as found.`;
}
