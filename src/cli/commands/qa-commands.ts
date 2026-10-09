/**
 * `peaks qa run` — the peaks-qa slice surface, and `peaks qa archive-screenshots`
 * — the Contract 1 remediation. The verbs live beside this file:
 *
 *   `qa-run-command.ts`                 the slice action (I/O + envelope)
 *   `qa-run-slice.ts`                   the pure gate list it drives
 *   `qa-run-options.ts`                 the `--no-X` flag contract
 *   `qa-context-prestep.ts`              Plan 1 / Task 9 context build
 *   `qa-archive-screenshots-command.ts` the stray-screenshot sweep
 *
 * This module owns only the `qa` parent (hidden) and the registrar order, and
 * re-exports every symbol it used to define so existing importers need no edit.
 */

import type { Command } from 'commander';

import type { ProgramIO } from '../cli-helpers.js';
import { registerQaArchiveScreenshotsCommand } from './qa-archive-screenshots-command.js';
import { registerQaRunCommand } from './qa-run-command.js';

export function registerQaCommands(program: Command, io: ProgramIO): void {
  const qa = program
    .command('qa', { hidden: true })
    .description(
      'peaks-qa slice: run QA gates (functional / security / browser E2E / mutation) for the active project'
    );

  registerQaRunCommand(qa, io);
  registerQaArchiveScreenshotsCommand(qa, io);
}

// Re-export for tests / external consumers; the implementations moved to the
// modules above with the split.
export { readQaRunOptions } from './qa-run-options.js';
export type { QaRunOptions } from './qa-run-options.js';
export { DEFAULT_MAX_BROWSER_RESTARTS, runQaSlice } from './qa-run-slice.js';
export type { QaGateStatus, QaRunResult, RunQaSliceInput } from './qa-run-slice.js';
