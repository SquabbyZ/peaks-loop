/**
 * `peaks log *` subcommands.
 *
 * Slice 2026-06-16-cli-logging (G4). Two subcommands:
 *   - `peaks log tail [--lines N]` — print the last N lines of
 *     today's JSONL log to stdout. With `--json`, prints as a
 *     JSON envelope (matching the project's response shape).
 *   - `peaks log ls` — list the available log files (newest first).
 *
 * The CLI layer is intentionally thin: it formats the output and
 * delegates the actual filesystem reads to
 * `src/services/log/log-commands-service.ts`. That service is
 * already covered by `tests/unit/log/log-commands.test.ts`.
 */

import { Command } from 'commander';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { tailLog, listLogFiles } from '../../services/log/log-commands-service.js';
import { getErrorMessage, printResult, addJsonOption, type ProgramIO } from '../cli-helpers.js';
import { ok, fail } from '../../shared/result.js';

export function registerLogCommands(program: Command, io: ProgramIO): void {
  const log = program
    .command('log')
    .description('Inspect the peaks-loop JSONL log directory (default: ~/.peaks/logs/)');

  addJsonOption(
    log
      .command('tail')
      .description('Print the last 50 lines of today\'s peaks-loop log (JSONL). Pass --lines N to change the count, --date YYYY-MM-DD to read a different day, --batch <id> to filter by batchId, --json to print a JSON envelope.')
      .option('--lines <n>', 'number of lines to show (default 50)', (value: string) => Number(value))
      .option('--date <YYYY-MM-DD>', 'read the log for this UTC date instead of today (PRD AC2: PEAKS_LOG_DATE_OVERRIDE)')
      // Slice 2026-06-23-audit-4th #B2: --batch filter for cross-run
      // correlation. Without this, a user post-hoc cannot group the
      // log lines for one batch (they interleave in the JSONL file).
      .option('--batch <id>', 'filter entries by batchId (sub-agent dispatch / heartbeat / share)')
  ).action((options: { lines?: number; date?: string; batch?: string; json?: boolean }) => {
    try {
      const requestedLines = options.lines ?? 50;
      const safeLines = Number.isFinite(requestedLines) && requestedLines > 0 ? Math.floor(requestedLines) : 50;
      const result = tailLog({
        lines: safeLines,
        ...(options.date !== undefined ? { dateOverride: options.date } : {}),
        ...(options.batch !== undefined ? { batchId: options.batch } : {})
      });
      printResult(
        io,
        ok('log.tail', {
          file: result.file,
          total: result.total,
          lines: safeLines,
          ...(options.batch !== undefined ? { batch: options.batch, batchMatches: result.batchMatches ?? 0 } : {}),
          entries: result.entries
        }, []),
        options.json
      );
    } catch (error) {
      printResult(io, fail('log.tail', 'LOG_TAIL_FAILED', getErrorMessage(error), {}, ['Check `peaks log ls` to see available log files']), options.json);
      process.exitCode = 1;
    }
  });

  addJsonOption(
    log
      .command('ls')
      .description('List peaks-loop-*.log files in ~/.peaks/logs/ (newest first).')
  ).action((options: { json?: boolean }) => {
    const files = listLogFiles();
    printResult(
      io,
      ok('log.ls', {
        logDir: join(homedir(), '.peaks', 'logs'),
        total: files.length,
        files
      }, []),
      options.json
    );
  });
}
