// src/cli/commands/batch-commands.ts
//
// `peaks batch` — the batch-mode surface of the race lane.
//
// The `batch` group is the lane's own surface, the way `race` is. The
// ACTION lives beside this file (`batch-diagnose-command.ts`), split out to
// honor the repo's file-size cap; the two share no logic — this one is the
// group and its option surface.
//
// WHY THE GROUP EXISTS AT ALL. Batch mode is an ADDITION to the lane, never
// a substitute for it. The lane's single-task path is unchanged by a batch,
// and the only thing that decides whether a request takes the batch path is
// how many independent items the user handed over — one item is not a batch.
// The action enforces that; the group exists so the surface is nameable.

import type { Command } from 'commander';

import { addJsonOption, type ProgramIO } from '../cli-helpers.js';
import { runBatchDiagnose } from './batch-diagnose-command.js';
import type { BatchDiagnoseOptions } from './batch-item-input.js';

/**
 * Register `peaks batch` and its `diagnose` action.
 */
export function registerBatchCommands(program: Command, io: ProgramIO): void {
  const batch = program
    .command('batch')
    .description(
      'Batch mode for the race lane: diagnose N mutually independent items in parallel, ' +
        'then plan the waves from the file sets they measured. One item is not a batch.'
    );
  addJsonOption(
    batch
      .command('diagnose')
      .description(
        'Diagnose a batch: one read-only diagnosis per item, recorded in the batch ' +
          'progress record. Dry-run by design — the CLI produces the toolCalls and the ' +
          'LLM executes them.'
      )
      .option('--rid <rid>', 'the request this batch belongs to')
      .option('--project <path>', 'target project root (defaults to the current directory)')
      .option('--items <file>', 'JSON file holding the batch items')
      .option('--items-json <json>', 'the batch items as inline JSON')
  ).action((options: BatchDiagnoseOptions) => {
    runBatchDiagnose(options, io);
  });
}
