/**
 * v2.15.0 follow-up — G13: impact scan CLI.
 *
 *   - `peaks impact scan`        — full impact report (changed files +
 *                                  affected flows + must-check list)
 *   - `peaks impact must-check`  — return just the must-check list
 *                                  (for piping into smoke / release)
 *
 * Lightweight glob-based implementation (no AST, no type checking).
 * Suitable for the "we don't have UT, give me a quick risk list"
 * use case from the 12 Gaps memory.
 */

import type { Command } from 'commander';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { mustCheckFromReport, runImpactScan } from '../../services/impact/impact-scan-service.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';

export function registerImpactCommands(program: Command, io: ProgramIO): void {
  const impact = program
    .command('impact')
    .description('v2.15.0 follow-up G13: lightweight impact scan (no AST, glob-based) for存量老项目无 UT 兜底.');

  addJsonOption(
    impact
      .command('scan')
      .description(
        'Scan the given changed files for impact: impacted files (siblings of changed), ' +
          'affected business flows (configurable), and the must-check list (concrete ' +
          'scenarios the user must verify before shipping). Pure local computation, no I/O.'
      )
      .requiredOption('--files <list>', 'comma-separated list of changed file paths (relative to project root)')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((opts: { files: string; project?: string; json?: boolean }) => {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const files = opts.files.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    if (files.length === 0) {
      printResult(io, fail('impact.scan', 'INVALID_INPUT', 'no files provided (--files)', { projectRoot }, [
        'Pass --files with at least one file path.'
      ]), opts.json ?? false);
      return;
    }
    const report = runImpactScan({ changedFiles: files });
    printResult(io, ok('impact.scan', { projectRoot, report }, [], report.warnings), opts.json ?? false);
  });

  addJsonOption(
    impact
      .command('must-check')
      .description(
        'Return just the must-check list for a set of changed files. ' +
          'Useful for piping into smoke / release verification flows. ' +
          'Accepts the same --files flag as `peaks impact scan`.'
      )
      .requiredOption('--files <list>', 'comma-separated list of changed file paths')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((opts: { files: string; project?: string; json?: boolean }) => {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const files = opts.files.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    if (files.length === 0) {
      printResult(io, fail('impact.must-check', 'INVALID_INPUT', 'no files provided (--files)', { projectRoot }, [
        'Pass --files with at least one file path.'
      ]), opts.json ?? false);
      return;
    }
    const report = runImpactScan({ changedFiles: files });
    const items = mustCheckFromReport(report);
    printResult(io, ok('impact.must-check', { projectRoot, count: items.length, items }, [], [
      items.length === 0
        ? 'No must-check items generated for the given changes.'
        : 'Pipe into `peaks smoke add-path` to register these as regression paths.'
    ]), opts.json ?? false);
  });
}
