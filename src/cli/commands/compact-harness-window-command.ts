// `peaks compact harness-window` — report / roll back the auto-compact pair
// peaks-loop writes into the harness's own machine-local settings.
//
// This file is the registrar and the dispatch. The reports and their sentences
// live in `compact-harness-window-reports.ts`, so the wording of a rollback can
// be reviewed in one place and this file stays under the file-size cap.
import type { Command } from 'commander';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { fail, getErrorMessage } from 'peaks-loop-shared/result';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  reportDisableHarnessWindow,
  reportHarnessWindowState,
  reportReenableHarnessWindow,
  reportResetHarnessWindow,
  reportUnmanagedHarnessWindow,
  resolveCommandLocation
} from './compact-harness-window-reports.js';

const HARNESS_WINDOW_DESCRIPTION =
  'Report / roll back the auto-compact pair peaks-loop writes into the ' +
  "harness's own machine-local settings (the adapter-declared " +
  'autoCompactWindowEnvVar and autoCompactPercentEnvVar, e.g. ' +
  'CLAUDE_CODE_AUTO_COMPACT_WINDOW and CLAUDE_AUTOCOMPACT_PCT_OVERRIDE in ' +
  '.claude/settings.local.json). peaks-loop computes its context ratio ' +
  'against exactly this window, so the value it reports as "85%" and the ' +
  'point the harness compacts at are the same. Context probes ' +
  '(`peaks code context-now`, `peaks code auto-compact`) materialize it ' +
  'automatically. Two different intentions, two verbs: --reset removes ' +
  'BOTH keys peaks-loop wrote (the window and the percent, with their ' +
  'provenance markers) AND opts the project out so later probes do not put ' +
  'them back — a percent left behind would move the trigger EARLIER, which ' +
  'is the opposite of a rollback; a percent you set by hand is kept. When ' +
  'the file holds no peaks-loop row at all there is nothing to roll back, ' +
  'so --reset writes nothing. --disable records the opt-out only, leaving ' +
  'whatever values are already there untouched, so "stop managing these ' +
  'keys" works on a project peaks-loop has never written to; --reenable ' +
  'undoes either opt-out (and is the way back from BOTH keys).';

interface CompactHarnessWindowOptions {
  project?: string;
  reset?: boolean;
  disable?: boolean;
  reenable?: boolean;
  json?: boolean;
}

function resolveHarnessWindowProject(options: CompactHarnessWindowOptions) {
  return options.project !== undefined
    ? resolveCanonicalProjectRoot(options.project)
    : (findProjectRoot(process.cwd()) ?? process.cwd());
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

    const location = resolveCommandLocation(project);
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
      .option(
        '--reset',
        'rollback: remove BOTH keys peaks-loop wrote (window + percent) and stop managing them'
      )
      .option(
        '--disable',
        'record the opt-out only (do not manage these keys), without removing values already there; expressible before the first write'
      )
      .option(
        '--reenable',
        'undo a --reset or --disable opt-out (peaks-loop manages the window and the percent again)'
      )
      .action((options: CompactHarnessWindowOptions) => runCompactHarnessWindow(options, io))
  );
}
