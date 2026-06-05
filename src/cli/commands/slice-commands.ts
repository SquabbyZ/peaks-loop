import { Command } from 'commander';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { sliceCheck } from '../../services/slice/slice-check-service.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

export function registerSliceCommands(program: Command, io: ProgramIO): void {
  const slice = program.command('slice').description(
    'Run slice-level checks (TDD micro-cycle boundary, see ' +
      'skills/peaks-solo/references/micro-cycle.md). `peaks slice check` bundles ' +
      'tsc + vitest + 3-way review fan-out + gate verify-pipeline. ' +
      'Boundaries only; do NOT run inside a micro-cycle.'
  );

  addJsonOption(
    slice
      .command('check')
      .description(
        'Boundary check for a slice (post-micro-cycle, pre-peaks-qa). ' +
          'Runs 4 stages in order: typecheck → unit-tests → review-fanout → ' +
          'gate-verify-pipeline. Each stage reports pass / fail / skipped. ' +
          'Exit 0 only if every stage passes or is skipped.'
      )
      .option('--project <path>', 'target project root', '.')
      .option('--rid <rid>', 'request id; defaults to the active current-change binding')
      .option('--refresh-fanout', 're-run the 3-way review fan-out (peaks-rd) even if the review files already exist', false)
      .option('--skip-tests', 'skip the unit-test stage (e.g. docs-only slices)', false)
  ).action(async (options: { project: string; rid?: string; refreshFanout?: boolean; skipTests?: boolean; json?: boolean }) => {
    try {
      const projectRoot = resolveCanonicalProjectRoot(options.project);
      const result = await sliceCheck({
        projectRoot,
        ...(options.rid ? { rid: options.rid } : {}),
        refreshFanout: options.refreshFanout === true,
        skipTests: options.skipTests === true
      });

      const warnings: string[] = [];
      if (result.stages.some((s) => s.status === 'fail')) {
        warnings.push(`${result.stages.filter((s) => s.status === 'fail').length} of ${result.stages.length} stages failed. 边界 NOT ready — fix the failures and re-run, or proceed at your own risk.`);
      }
      printResult(io, ok('slice.check', result, warnings, result.nextActions), options.json ?? false);
      if (!result.boundaryReady) {
        process.exitCode = 1;
      }
    } catch (error) {
      printResult(io, fail('slice.check', 'SLICE_CHECK_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Verify the project path is a peaks repo, --rid is correct, and .peaks/_runtime/current-change is valid']), options.json ?? false);
      process.exitCode = 1;
    }
  });
}
