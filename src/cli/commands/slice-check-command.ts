// Split out of `slice-commands.ts`:
// `peaks slice check`, the post-micro-cycle boundary gate.
import type { Command } from 'commander';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { sliceCheck } from '../../services/slice/slice-check-service.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

const CHECK_DESCRIPTION =
  'Boundary check for a slice (post-micro-cycle, pre-peaks-qa). ' +
  'Runs 4 stages in order: typecheck -> unit-tests (changed-only by default; ' +
  'use --run-tests for the full suite, or --skip-tests to opt out) -> ' +
  'review-fanout -> gate-verify-pipeline. ' +
  'Each stage reports pass / fail / skipped. ' +
  'Exit 0 only if every stage passes or is skipped.';
const CHECK_PROJECT_HELP = 'target project root';
const CHECK_RID_HELP =
  'request id; REQUIRED — there is no binding to fall back to, and slice check fails without it';
const CHECK_REFRESH_FANOUT_HELP =
  're-run the 3-way review fan-out (peaks-rd) even if the review files already exist';
const CHECK_RUN_TESTS_HELP =
  'opt in to the FULL test suite at the boundary (default is the changed-only suite via `vitest run --changed`); use the peaks-test skill to run the full suite standalone';
const CHECK_SKIP_TESTS_HELP =
  'skip the unit-test stage entirely (e.g. docs-only slices); use the peaks-test skill to run the full suite manually if you want a separate check';
const CHECK_ALLOW_PRE_EXISTING_HELP =
  'opt-in: if the unit-test stage fails, report it as `skipped` with a reason naming the failure count (useful when the repo has unrelated pre-existing failures; the long-term fix is to .skip or coverage.exclude those tests). Only meaningful with --run-tests or the default changed-only mode.';

type SliceCheckOptions = {
  project: string;
  rid?: string;
  refreshFanout?: boolean;
  runTests?: boolean;
  skipTests?: boolean;
  allowPreExistingFailures?: boolean;
  json?: boolean;
};

async function runSliceCheck(options: SliceCheckOptions, io: ProgramIO): Promise<void> {
  try {
    const projectRoot = resolveCanonicalProjectRoot(options.project);
    const result = await sliceCheck({
      projectRoot,
      ...(options.rid ? { rid: options.rid } : {}),
      refreshFanout: options.refreshFanout === true,
      runTests: options.runTests === true,
      skipTests: options.skipTests === true,
      allowPreExistingFailures: options.allowPreExistingFailures === true
    });

    const warnings: string[] = [];
    if (result.stages.some((s) => s.status === 'fail')) {
      warnings.push(
        `${result.stages.filter((s) => s.status === 'fail').length} of ${result.stages.length} stages failed. 边界 NOT ready -- fix the failures and re-run, or proceed at your own risk.`
      );
    }
    printResult(io, ok('slice.check', result, warnings, result.nextActions), options.json ?? false);
    if (!result.boundaryReady) {
      process.exitCode = 1;
    }
  } catch (error) {
    printResult(
      io,
      fail(
        'slice.check',
        'SLICE_CHECK_FAILED',
        getErrorMessage(error),
        { projectRoot: options.project },
        [
          `Verify the project path is a peaks repo and --rid names a slice (letters, digits, dots, underscores or dashes): ${options.rid ?? '(no --rid given)'}`
        ]
      ),
      options.json ?? false
    );
    process.exitCode = 1;
  }
}

export function registerSliceCheckCommand(slice: Command, io: ProgramIO): void {
  addJsonOption(
    slice
      .command('check')
      .description(CHECK_DESCRIPTION)
      .option('--project <path>', CHECK_PROJECT_HELP, '.')
      .option('--rid <rid>', CHECK_RID_HELP)
      .option('--refresh-fanout', CHECK_REFRESH_FANOUT_HELP, false)
      .option('--run-tests', CHECK_RUN_TESTS_HELP, false)
      .option('--skip-tests', CHECK_SKIP_TESTS_HELP, false)
      .option('--allow-pre-existing-failures', CHECK_ALLOW_PRE_EXISTING_HELP, false)
  ).action((options: SliceCheckOptions) => runSliceCheck(options, io));
}
