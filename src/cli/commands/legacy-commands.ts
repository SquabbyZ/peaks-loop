/**
 * v2.15.0 follow-up — G8: peaks legacy detect CLI.
 *
 *   - `peaks legacy detect --dir <path>` — scan a directory for legacy
 *     smells (TODO/FIXME/HACK, console.log, any-type, large files, ts-ignore).
 *     Useful as a "where to start" inventory when peaks-cli is applied
 *     to a 存量老项目.
 */

import type { Command } from 'commander';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { detectLegacy } from '../../services/legacy/legacy-detector.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';

export function registerLegacyCommands(program: Command, io: ProgramIO): void {
  addJsonOption(
    program
      .command('legacy-detect')
      .description(
        'v2.15.0 follow-up G8: scan a directory for legacy smells (TODO/FIXME/HACK, ' +
          'console.log, any-type, large files, ts-ignore). Returns a smell grade ' +
          '(low / medium / high) and per-kind counts. Lightweight heuristics — ' +
          'NOT a replacement for a real linter. Useful as a "where to start" ' +
          'inventory when peaks-cli is applied to a legacy codebase.'
      )
      .option('--dir <path>', 'directory to scan (default: src)', 'src')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((opts: { dir: string; project?: string; json?: boolean }) => {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const report = detectLegacy(projectRoot, opts.dir);
    printResult(io, ok('legacy-detect', { projectRoot, dir: opts.dir, report }, [], [
      `Scanned ${report.scannedFiles} file(s). Smells: ${report.smells}.`,
      report.smells === 'high'
        ? 'Consider refactoring high-smell areas first.'
        : 'Manageable technical debt.'
    ]), opts.json ?? false);
  });
}
