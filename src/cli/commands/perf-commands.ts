import { Command } from 'commander';
import { executePerfBaselineInit, resolveProjectRootFromCwd, type PerfBaselineInitOptions } from '../../services/perf/perf-baseline-service.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

type PerfBaselineCommandOptions = PerfBaselineInitOptions & {
  project?: string;
  json?: boolean;
};

export function registerPerfCommands(program: Command, io: ProgramIO): void {
  const perf = program.command('perf').description('Manage performance baseline scaffolding for the RD stage');

  addJsonOption(
    perf
      .command('baseline')
      .description('Scaffold .peaks/_runtime/<sid>/rd/perf-baseline.md so the RD can record the slice\'s perf numbers in a stable place that QA Gate A4 can diff against. Default dry-run; pass --apply to write.')
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
      .option('--apply', 'write the scaffold into the target project', false)
      .option('--reason <text>', 'human-readable reason for the baseline (recorded in the response data)')
  ).action(async (options: PerfBaselineCommandOptions) => {
    try {
      const projectRoot = options.project !== undefined
        ? options.project
        : resolveProjectRootFromCwd(process.cwd());
      const result = await executePerfBaselineInit({
        projectRoot,
        apply: options.apply === true,
        ...(options.reason !== undefined ? { reason: options.reason } : {})
      });
      const nextActions: string[] = [];
      if (result.sessionId === null) {
        nextActions.push('No peaks session is bound for this project yet. Run `peaks workspace init` (or any peaks skill) first so a session directory exists.');
      } else if (result.alreadyInitialized) {
        nextActions.push(`perf-baseline.md already exists; no files were written. Re-run only after a re-measurement if you intend to overwrite.`);
      } else if (!result.apply) {
        nextActions.push('Re-run with --apply to write the scaffold.');
      } else {
        nextActions.push('Open the file and fill in the Results table — that is the input QA Gate A4 will diff against.');
      }
      printResult(io, ok('perf.baseline', result, [], nextActions), options.json);
    } catch (error) {
      printResult(
        io,
        fail('perf.baseline', 'PERF_BASELINE_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Verify the project path exists and is writable']),
        options.json
      );
      process.exitCode = 1;
    }
  });
}
