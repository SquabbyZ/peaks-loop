/**
 * v2.15.0 follow-up — G10: peaks complexity estimate CLI.
 *
 *   - `peaks complexity estimate --files <list>` — per-file tier +
 *     aggregate. Aligns with the G2 12 Gaps memory tier definition.
 */

import type { Command } from 'commander';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { estimateComplexity } from '../../services/complexity/complexity-estimator.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';

export function registerComplexityCommands(program: Command, io: ProgramIO): void {
  addJsonOption(
    program
      .command('complexity-estimate')
      .description(
        'v2.15.0 follow-up G10: estimate the complexity tier (trivial / simple / ' +
          'complex) of a set of files, based on LOC + export count + async usage. ' +
          'Aligns with the G2 12 Gaps memory tier definition. The aggregate ' +
          'tier drives scheduling (trivial / simple → overnight; complex → ' +
          'user-attended).'
      )
      .requiredOption('--files <list>', 'comma-separated file paths (relative to project root)')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((opts: { files: string; project?: string; json?: boolean }) => {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const files = opts.files.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    if (files.length === 0) {
      printResult(io, fail('complexity-estimate', 'INVALID_INPUT', 'no files provided (--files)', { projectRoot }, [
        'Pass --files with at least one file path.'
      ]), opts.json ?? false);
      return;
    }
    const report = estimateComplexity(projectRoot, files);
    printResult(io, ok('complexity-estimate', { projectRoot, report }, [], [
      `Overall tier: ${report.overall}. Schedule accordingly.`
    ]), opts.json ?? false);
  });
}
