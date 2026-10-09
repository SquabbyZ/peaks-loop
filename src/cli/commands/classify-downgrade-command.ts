// src/cli/commands/classify-downgrade-command.ts
//
// `peaks classify downgrade` — REFUSED per spec §4: the CLI never downgrades a
// classification unilaterally. Extracted from
// `governance-classify-contract-commands.ts`; the registered name, description,
// options, refusal code and exit code (2) are unchanged.

import type { Command } from 'commander';
import { fail } from 'peaks-loop-shared/result';

import { printResult, type ProgramIO } from '../cli-helpers.js';

export type ClassifyDowngradeOptions = {
  project: string;
  level: string;
  reason: string;
  json?: boolean;
};

export function registerClassifyDowngradeCommand(classify: Command, io: ProgramIO): void {
  classify
    .command('downgrade')
    .description(
      'REFUSED per spec §4 — peaks-loop never downgrades a classification; ask the user to override explicitly'
    )
    .requiredOption('--level <level>', 'attempted level')
    .requiredOption('--reason <text>', 'reason for the attempt (always rejected)')
    .requiredOption('--project <path>', 'target project root')
    .option('--json', 'print machine-readable JSON envelope')
    .action((options: ClassifyDowngradeOptions) => {
      printResult(
        io,
        fail(
          'classify.downgrade',
          'DOWNGRADE_REFUSED',
          'peaks classify downgrade is refused per spec §4. Use --override (with reason) on `classify run` to force a level; the CLI never downgrades a classification unilaterally.',
          { attemptedLevel: options.level, reason: options.reason },
          ['Use `peaks classify run --override <level> --reason "<text>"` instead']
        ),
        options.json
      );
      process.exitCode = 2;
    });
}
