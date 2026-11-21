// The `--disable` / `--reenable` halves of `peaks compact harness-window`, split
// out of `compact-harness-window-reports.ts` when that file crossed the 300-raw-
// line cap. Every body below is the original one, moved; the two verbs are the
// pair that EDIT the opt-out row, so they belong together.
import { ok } from 'peaks-loop-shared/result';
import { printResult, type ProgramIO } from '../cli-helpers.js';
import {
  disableHarnessWindowSync,
  reenableHarnessWindowSync,
  type HarnessWindowLocation
} from '../../services/context/harness-window-config.js';
import {
  describeReenabledPercent,
  readPercentReport,
  type HarnessPercentReport
} from './compact-harness-window-percent.js';

/**
 * One sentence per `--disable` outcome.
 *
 * A REFUSAL IS NAMED AS ONE. `symlinked-settings` has its own clause because the
 * file may parse perfectly — the problem is where the write would LAND — and
 * `unreadable-settings` is deliberately the fall-through rather than a token.
 */
function buildDisableWindowActions(
  result: ReturnType<typeof disableHarnessWindowSync>,
  location: HarnessWindowLocation
) {
  return [
    result.action === 'disabled'
      ? `Recorded the opt-out in ${result.settingsPath}: peaks-loop will not write ${location.envVar} here, and left any value already in the file exactly as it was. Undo with \`peaks compact harness-window --reenable\`.`
      : result.action === 'already-opted-out'
        ? `Already opted out — ${result.settingsPath} carries ${location.envVar}'s opt-out, so nothing was written. Undo with \`peaks compact harness-window --reenable\`.`
        : result.action === 'refused-unsafe-project-root'
          ? `Nothing written: the resolved project root is the user's own home directory, so ${result.settingsPath} is their PERSONAL harness settings, not a project's. peaks-loop already refuses to write ${location.envVar} there, so an opt-out would change nothing except which refusal you see. Point --project at a project (a subdirectory of home is fine) and the opt-out lands there.`
          : result.action === 'symlinked-settings'
            ? `Nothing written — ${result.settingsPath} is a symlink (or a Windows junction), or the directory holding it is, so recording the opt-out would follow the link and overwrite the file it points at. Replace the link with a real file (or directory) and the opt-out lands here.`
            : `Nothing written — ${result.settingsPath} is not a JSON object peaks-loop can safely edit, so the opt-out could not be recorded there.`
  ];
}

export function reportDisableHarnessWindow(
  io: ProgramIO,
  project: string,
  location: HarnessWindowLocation,
  json?: boolean
): void {
  const result = disableHarnessWindowSync({ location });
  printResult(
    io,
    ok(
      'compact.harness-window',
      {
        projectRoot: project,
        action: result.action,
        key: location.envVar,
        settingsPath: result.settingsPath
      },
      [],
      buildDisableWindowActions(result, location)
    ),
    json
  );
}

function buildReenableWindowActions(
  result: ReturnType<typeof reenableHarnessWindowSync>,
  location: HarnessWindowLocation,
  percent: HarnessPercentReport | null
) {
  // N4 — SAY WHAT HAPPENS TO EACH KNOB (the percent clause has its own reason
  // in `describeReenabledPercent`). `--reenable` only clears the opt-out; it
  // removes nothing and writes no values, so after a `--reset` the next probe
  // fills the window only.
  //
  // A REFUSAL (home root, a linked file) is NAMED rather than folded into
  // "No opt-out was recorded": nothing was cleared, and saying otherwise would
  // report a refusal as a no-op.
  const percentOutcome = describeReenabledPercent(percent);
  if (result.action === 'refused-unsafe-project-root') {
    return [
      `Nothing written: the resolved project root is the user's own home directory, so ${result.settingsPath} is their PERSONAL harness settings, not a project's. Point --project at a project (a subdirectory of home is fine) and --reenable lands there.${percentOutcome}`
    ];
  }
  if (result.action === 'symlinked-settings') {
    return [
      `Nothing written — ${result.settingsPath} is a symlink (or a Windows junction), or the directory holding it is, so clearing the opt-out would follow the link and overwrite the file it points at. Replace the link with a real file (or directory) and --reenable lands here.${percentOutcome}`
    ];
  }
  return [
    result.action === 'reenabled'
      ? `Opt-out cleared; the next context probe will materialize the window ${location.envVar} again.${percentOutcome}`
      : `No opt-out was recorded for this project.${percentOutcome}`
  ];
}

export function reportReenableHarnessWindow(
  io: ProgramIO,
  project: string,
  location: HarnessWindowLocation,
  json?: boolean
): void {
  const percent = readPercentReport(project);
  const result = reenableHarnessWindowSync({ location });
  printResult(
    io,
    ok(
      'compact.harness-window',
      {
        projectRoot: project,
        action: result.action,
        key: location.envVar,
        settingsPath: result.settingsPath,
        // The percent half is reported too, so the envelope answers "what is
        // managed now" for BOTH keys rather than the window alone.
        percent
      },
      [],
      buildReenableWindowActions(result, location, percent)
    ),
    json
  );
}
