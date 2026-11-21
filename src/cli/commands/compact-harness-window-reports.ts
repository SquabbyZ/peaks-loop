// The `peaks compact harness-window` REPORTS and their sentences — split out of
// `compact-harness-window-command.ts` so that file keeps the registrar and the
// dispatch only. Every body below is the original one, moved.
import { ok } from 'peaks-loop-shared/result';
import { printResult, type ProgramIO } from '../cli-helpers.js';
import {
  readHarnessWindowState,
  resolveHarnessWindowLocation
} from '../../services/context/auto-compact-reader.js';
import {
  resetHarnessWindow,
  type HarnessWindowLocation,
  type HarnessWindowReadResult,
  type HarnessWindowResetResult
} from '../../services/context/harness-window-config.js';
import { resolveHarnessCompactThresholdLocation } from '../../services/context/harness-compact-threshold-config.js';
import {
  describePercentHalf,
  readPercentReport,
  type HarnessPercentReport
} from './compact-harness-window-percent.js';
// The two verbs that EDIT the opt-out row moved to their own module when this
// file crossed the 300-raw-line cap; re-exported so the dispatcher's import path
// and every existing caller stay put.
export {
  reportDisableHarnessWindow,
  reportReenableHarnessWindow
} from './compact-harness-window-opt-out.js';
import {
  describeHarnessThresholdReset,
  resetHarnessThreshold
} from '../../services/context/harness-compact-threshold-reset.js';

export function reportUnmanagedHarnessWindow(io: ProgramIO, project: string, json?: boolean): void {
  printResult(
    io,
    ok('compact.harness-window', {
      projectRoot: project,
      managed: false,
      message:
        'The active IDE adapter declares no auto-compact window key, so peaks-loop cannot tie ' +
        'the harness window to its own ratio. Nothing was written and there is nothing to roll back.'
    }),
    json
  );
}

/**
 * The rollback over the PAIR: `--reset` must undo BOTH knobs, because an orphaned
 * percent moves the trigger EARLIER while the opt-out claims nothing is managed.
 * Returns `null` when the adapter declares no percent knob — refusing there would
 * take away the only way back it ever had.
 */
function runResetHarnessThreshold(
  project: string
): ReturnType<typeof resetHarnessThreshold> | null {
  const thresholdLocation = resolveHarnessCompactThresholdLocation({
    projectRoot: project,
    env: process.env
  });
  return thresholdLocation === null ? null : resetHarnessThreshold({ thresholdLocation });
}

function buildResetWindowActions(
  result: HarnessWindowResetResult,
  location: HarnessWindowLocation
) {
  return [
    result.action === 'removed'
      ? `Removed ${location.envVar} from ${result.settingsPath} and opted this project out, so later probes stop writing it. Undo with \`peaks compact harness-window --reenable\`.`
      : `Nothing to remove — ${location.envVar} was already absent from ${result.settingsPath}, so nothing was written and no opt-out row was recorded: if a probe writes a window here later, run --reset again to remove it. To say "never manage this key here" WITHOUT waiting for that first write, run \`peaks compact harness-window --disable\`.`
  ];
}

/**
 * The envelope's `action` for a threshold reset. A refusal is neither `removed`
 * nor `absent`: it is `refused`, so a consumer reading `action` cannot mistake a
 * write that was DECLINED for one that found nothing to do.
 *
 * `removed` when EITHER knob was removed. Keying off `window.action` alone
 * reported `absent` beside `percent.action: 'removed'` for a percent-only
 * removal (a file whose window was deleted by hand), and — worse — reported
 * `removed` on a REFUSAL whose snapshot was taken before the refusal was
 * decided, because ownership is computed from the file regardless of whether a
 * write follows. A refusal reports no removals at all.
 */
function thresholdResetAction(
  threshold: ReturnType<typeof resetHarnessThreshold>
): 'removed' | 'absent' | 'refused' {
  if (threshold.refusal !== undefined) return 'refused';
  const removed = threshold.window.action === 'removed' || threshold.percent.action === 'removed';
  return removed ? 'removed' : 'absent';
}

/** The threshold half of the reset envelope — both knobs plus the refusal. */
function buildThresholdResetData(
  project: string,
  location: HarnessWindowLocation,
  threshold: ReturnType<typeof resetHarnessThreshold>
) {
  // A REFUSAL REMOVED NOTHING. The snapshot's per-knob actions are computed from
  // the file whether or not a write follows, so reporting them as `removed` on
  // a refused call would describe a removal this call declined to perform.
  const refused = threshold.refusal !== undefined;
  return {
    projectRoot: project,
    action: thresholdResetAction(threshold),
    ...(threshold.refusal === undefined ? {} : { reason: threshold.refusal }),
    key: location.envVar,
    settingsPath: threshold.settingsPath,
    previousTokens: threshold.window.previousTokens,
    // The window half is REPORTED too: a rollback that kept a human's window
    // would otherwise look identical to one that removed it.
    window: {
      key: threshold.window.key,
      action: refused ? 'absent' : threshold.window.action,
      ownership: threshold.window.ownership
    },
    // The percent half is REPORTED, not just acted on: a rollback that silently
    // kept a human's value would look identical to one that failed. Its
    // `ownership` is what distinguishes `kept-human` from `absent` on `none`,
    // so a consumer does not have to infer it from the action.
    percent: {
      key: threshold.percent.key,
      action: refused ? 'absent' : threshold.percent.action,
      ownership: threshold.percent.ownership,
      previousPercent: threshold.percent.previousPercent
    },
    optedOut: threshold.optedOut
  };
}

export function reportResetHarnessWindow(
  io: ProgramIO,
  project: string,
  location: HarnessWindowLocation,
  json?: boolean
): void {
  const threshold = runResetHarnessThreshold(project);
  if (threshold === null) {
    // Adapter declares no percent knob — the window is the whole pair.
    const result = resetHarnessWindow({ location, env: process.env });
    printResult(
      io,
      ok(
        'compact.harness-window',
        {
          projectRoot: project,
          action: result.action,
          key: location.envVar,
          settingsPath: result.settingsPath,
          previousTokens: result.previousTokens
        },
        [],
        buildResetWindowActions(result, location)
      ),
      json
    );
    return;
  }
  printResult(
    io,
    ok(
      'compact.harness-window',
      buildThresholdResetData(project, location, threshold),
      [],
      [describeHarnessThresholdReset(threshold)]
    ),
    json
  );
}

function buildHarnessWindowStateActions(
  state: HarnessWindowReadResult | null,
  percent: HarnessPercentReport | null
) {
  return [
    state?.tokens === null || state?.tokens === undefined
      ? 'No window is set yet. The next `peaks code context-now` probe materializes the window it computes its ratio against.'
      : `peaks-loop computes its context ratio against ${state.tokens} tokens; the harness fires near the end of that window. ${
          state.peakWritten
            ? 'peaks-loop wrote this value; it may raise it if a session outgrows it.'
            : "This value is not peaks-loop's own write, so peaks-loop will not raise it — it is treated as your setting."
        }`,
    describePercentHalf(percent),
    'Rollback: `peaks compact harness-window --reset`.',
    'Intent-vs-observed calibration: `peaks compact history --json` → windowCalibration.'
  ];
}

function buildHarnessWindowStateData(
  project: string,
  location: HarnessWindowLocation,
  state: HarnessWindowReadResult | null,
  percent: HarnessPercentReport | null
) {
  return {
    projectRoot: project,
    managed: true,
    key: location.envVar,
    settingsPath: location.settingsPath,
    tokens: state?.tokens ?? null,
    // Bounded at the service layer's source (MED-2); carry the note through.
    rawNote: state?.rawNote ?? null,
    source: state?.source ?? null,
    optedOut: state?.optedOut ?? false,
    // Provenance: whether this value is peaks-loop's own write or
    // one the user set by hand. It decides whether the late 1M
    // rescue may override it, so it is not just diagnostics.
    peakWritten: state?.peakWritten ?? false,
    // The OTHER half of the pair — the state report is about both knobs.
    percent
  };
}

export function reportHarnessWindowState(
  io: ProgramIO,
  project: string,
  location: HarnessWindowLocation,
  json?: boolean
): void {
  const state = readHarnessWindowState({ projectRoot: project, env: process.env });
  const percent = readPercentReport(project);
  printResult(
    io,
    ok(
      'compact.harness-window',
      buildHarnessWindowStateData(project, location, state, percent),
      [],
      buildHarnessWindowStateActions(state, percent)
    ),
    json
  );
}

/** The one place the command's location is resolved, so the reports share it. */
export function resolveCommandLocation(project: string): HarnessWindowLocation | null {
  return resolveHarnessWindowLocation({ projectRoot: project, env: process.env });
}
