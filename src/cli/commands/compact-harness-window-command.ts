// `peaks compact harness-window` — report / roll back the auto-compact window
// peaks-loop writes into the harness's own machine-local settings.
import type { Command } from 'commander';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { fail, ok, getErrorMessage } from 'peaks-loop-shared/result';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  readHarnessWindowState,
  resolveHarnessWindowLocation
} from '../../services/context/auto-compact-reader.js';
import {
  disableHarnessWindowSync,
  reenableHarnessWindowSync,
  resetHarnessWindow,
  type HarnessWindowLocation,
  type HarnessWindowReadResult
} from '../../services/context/harness-window-config.js';

const HARNESS_WINDOW_DESCRIPTION =
  'Report / roll back the auto-compact window peaks-loop writes into the ' +
  "harness's own machine-local settings (the adapter-declared " +
  'autoCompactWindowEnvVar, e.g. CLAUDE_CODE_AUTO_COMPACT_WINDOW in ' +
  '.claude/settings.local.json). peaks-loop computes its context ratio ' +
  'against exactly this number, so the value it reports as "85%" and the ' +
  'point the harness compacts at are the same. Context probes ' +
  '(`peaks code context-now`, `peaks code auto-compact`) materialize it ' +
  'automatically. Two different intentions, two verbs: --reset removes ' +
  'the key AND opts the project out so later probes do not put it back ' +
  '(when the file holds no peaks-loop row at all there is nothing to ' +
  'roll back, so --reset writes nothing); --disable records the opt-out ' +
  'only, leaving whatever value is already there untouched, so "stop ' +
  'managing this key" works on a project peaks-loop has never written ' +
  'to; --reenable undoes either opt-out.';

interface CompactHarnessWindowOptions {
  project?: string;
  reset?: boolean;
  disable?: boolean;
  reenable?: boolean;
  json?: boolean;
}

type ResetWindowResult = ReturnType<typeof resetHarnessWindow>;
type DisableWindowResult = ReturnType<typeof disableHarnessWindowSync>;
type ReenableWindowResult = ReturnType<typeof reenableHarnessWindowSync>;

function resolveHarnessWindowProject(options: CompactHarnessWindowOptions) {
  return options.project !== undefined
    ? resolveCanonicalProjectRoot(options.project)
    : (findProjectRoot(process.cwd()) ?? process.cwd());
}

function reportUnmanagedHarnessWindow(io: ProgramIO, project: string, json?: boolean): void {
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

function buildResetWindowActions(result: ResetWindowResult, location: HarnessWindowLocation) {
  return [
    result.action === 'removed'
      ? `Removed ${location.envVar} from ${result.settingsPath} and opted this project out, so later probes stop writing it. Undo with \`peaks compact harness-window --reenable\`.`
      : `Nothing to remove — ${location.envVar} was already absent from ${result.settingsPath}, so nothing was written and no opt-out row was recorded: if a probe writes a window here later, run --reset again to remove it. To say "never manage this key here" WITHOUT waiting for that first write, run \`peaks compact harness-window --disable\`.`
  ];
}

function reportResetHarnessWindow(
  io: ProgramIO,
  project: string,
  location: HarnessWindowLocation,
  json?: boolean
): void {
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
}

function buildDisableWindowActions(result: DisableWindowResult, location: HarnessWindowLocation) {
  return [
    result.action === 'disabled'
      ? `Recorded the opt-out in ${result.settingsPath}: peaks-loop will not write ${location.envVar} here, and left any value already in the file exactly as it was. Undo with \`peaks compact harness-window --reenable\`.`
      : result.action === 'already-opted-out'
        ? `Already opted out — ${result.settingsPath} carries ${location.envVar}'s opt-out, so nothing was written. Undo with \`peaks compact harness-window --reenable\`.`
        : result.action === 'refused-unsafe-project-root'
          ? `Nothing written: the resolved project root is the user's own home directory, so ${result.settingsPath} is their PERSONAL harness settings, not a project's. peaks-loop already refuses to write ${location.envVar} there, so an opt-out would change nothing except which refusal you see. Point --project at a project (a subdirectory of home is fine) and the opt-out lands there.`
          : `Nothing written — ${result.settingsPath} is not a JSON object peaks-loop can safely edit, so the opt-out could not be recorded there.`
  ];
}

function reportDisableHarnessWindow(
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

function buildReenableWindowActions(result: ReenableWindowResult) {
  return [
    result.action === 'reenabled'
      ? 'Opt-out cleared; the next context probe will materialize the window again.'
      : 'No opt-out was recorded for this project.'
  ];
}

function reportReenableHarnessWindow(
  io: ProgramIO,
  project: string,
  location: HarnessWindowLocation,
  json?: boolean
): void {
  const result = reenableHarnessWindowSync({ location });
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
      buildReenableWindowActions(result)
    ),
    json
  );
}

function buildHarnessWindowStateActions(state: HarnessWindowReadResult | null) {
  return [
    state?.tokens === null || state?.tokens === undefined
      ? 'No window is set yet. The next `peaks code context-now` probe materializes the window it computes its ratio against.'
      : `peaks-loop computes its context ratio against ${state.tokens} tokens; the harness fires near the end of that window. ${
          state.peakWritten
            ? 'peaks-loop wrote this value; it may raise it if a session outgrows it.'
            : "This value is not peaks-loop's own write, so peaks-loop will not raise it — it is treated as your setting."
        }`,
    'Rollback: `peaks compact harness-window --reset`.',
    'Intent-vs-observed calibration: `peaks compact history --json` → windowCalibration.'
  ];
}

function buildHarnessWindowStateData(
  project: string,
  location: HarnessWindowLocation,
  state: HarnessWindowReadResult | null
) {
  return {
    projectRoot: project,
    managed: true,
    key: location.envVar,
    settingsPath: location.settingsPath,
    tokens: state?.tokens ?? null,
    raw: state?.raw ?? null,
    source: state?.source ?? null,
    optedOut: state?.optedOut ?? false,
    // Provenance: whether this value is peaks-loop's own write or
    // one the user set by hand. It decides whether the late 1M
    // rescue may override it, so it is not just diagnostics.
    peakWritten: state?.peakWritten ?? false
  };
}

function reportHarnessWindowState(
  io: ProgramIO,
  project: string,
  location: HarnessWindowLocation,
  json?: boolean
): void {
  const state = readHarnessWindowState({ projectRoot: project, env: process.env });
  printResult(
    io,
    ok(
      'compact.harness-window',
      buildHarnessWindowStateData(project, location, state),
      [],
      buildHarnessWindowStateActions(state)
    ),
    json
  );
}

function reportHarnessWindowFailure(io: ProgramIO, error: unknown, json?: boolean): void {
  printResult(
    io,
    fail('compact.harness-window', 'COMPACT_HARNESS_WINDOW_FAILED', getErrorMessage(error), {}, [
      'Verify the project path is writable and a session is bound'
    ]),
    json
  );
  process.exitCode = 1;
}

function runCompactHarnessWindow(options: CompactHarnessWindowOptions, io: ProgramIO): void {
  try {
    const project = resolveHarnessWindowProject(options);

    const location = resolveHarnessWindowLocation({
      projectRoot: project,
      env: process.env
    });
    if (location === null) {
      reportUnmanagedHarnessWindow(io, project, options.json);
      return;
    }

    if (options.reset === true) {
      reportResetHarnessWindow(io, project, location, options.json);
      return;
    }

    if (options.disable === true) {
      reportDisableHarnessWindow(io, project, location, options.json);
      return;
    }

    if (options.reenable === true) {
      reportReenableHarnessWindow(io, project, location, options.json);
      return;
    }

    reportHarnessWindowState(io, project, location, options.json);
  } catch (error) {
    reportHarnessWindowFailure(io, error, options.json);
  }
}

export function registerCompactHarnessWindowCommand(compact: Command, io: ProgramIO): void {
  // 7. peaks compact harness-window [--reset | --disable | --reenable]
  //
  // The window peaks-loop divides by and the window the harness compacts
  // against must be ONE number, or "95%" lands at two different token counts.
  // This command is the visible half of that write: the default reports what
  // is in force, `--reset` removes it, `--disable` stops managing it.
  //
  // There is deliberately NO `--sync` flag. Materializing the window requires
  // the ratio's own denominator, which only a probe has (it is the only place
  // the active model is known). A `--sync` that re-derived the window here
  // would be the second, independent resolution this slice exists to delete —
  // `peaks code context-now` and `peaks code auto-compact` already sync.
  addJsonOption(
    compact
      .command('harness-window')
      .description(HARNESS_WINDOW_DESCRIPTION)
      .option('--project <path>', 'project root (defaults to git root or cwd)')
      .option('--reset', 'rollback: remove the window key and stop managing it')
      .option(
        '--disable',
        'record the opt-out only (do not manage this key), without removing a value that is already there; expressible before the first write'
      )
      .option('--reenable', 'undo a --reset or --disable opt-out (peaks-loop manages it again)')
      .action((options: CompactHarnessWindowOptions) => runCompactHarnessWindow(options, io))
  );
}
