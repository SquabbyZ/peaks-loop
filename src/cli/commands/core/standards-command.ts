import type { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../../cli-helpers.js';
import { registerStandardsInitCommands } from './standards-init-command.js';
import { LOOP_ENGINEERING_CATEGORY, runLoopEngineeringLint } from './standards-lint.js';
import { registerStandardsMigrateCommand } from './standards-migrate-command.js';

export {
  LOOP_ENGINEERING_CATEGORY,
  LOOP_ENGINEERING_GUIDELINES_RELATIVE_PATH,
  runLoopEngineeringLint,
  type StandardsLintEnvelope
} from './standards-lint.js';

/** `standards lint` prints the pure lint result as a CLI envelope. */
function runStandardsLint(
  io: ProgramIO,
  options: { category: string; project?: string; json?: boolean }
): void {
  if (options.category !== LOOP_ENGINEERING_CATEGORY) {
    printResult(
      io,
      fail(
        'standards.lint',
        'UNKNOWN_LINT_CATEGORY',
        `only --category ${LOOP_ENGINEERING_CATEGORY} is implemented`,
        { category: options.category },
        [`Pass --category ${LOOP_ENGINEERING_CATEGORY}.`]
      ),
      options.json
    );
    process.exitCode = 1;
    return;
  }
  try {
    const envelope = runLoopEngineeringLint(options.project ?? process.cwd());
    const response = envelope.ok
      ? ok('standards.lint', envelope.data, [], envelope.nextActions)
      : fail(
          'standards.lint',
          envelope.code,
          envelope.message,
          envelope.data,
          envelope.nextActions
        );
    printResult(io, response, options.json);
    if (!envelope.ok) {
      process.exitCode = 1;
    }
  } catch (error: unknown) {
    printResult(
      io,
      fail(
        'standards.lint',
        'STANDARDS_LINT_ERROR',
        getErrorMessage(error),
        { category: options.category },
        ['Verify the guideline file is readable.']
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

function registerStandardsLintCommand(standards: Command, io: ProgramIO): void {
  addJsonOption(
    standards
      .command('lint')
      .description(
        'Lint a guideline file for structural completeness (the loop-engineering red lines)'
      )
      .requiredOption(
        '--category <category>',
        `guideline category to lint (${LOOP_ENGINEERING_CATEGORY})`
      )
      .option('--project <path>', 'project root holding .peaks/standards/ (default: cwd)')
  ).action((options: { category: string; project?: string; json?: boolean }) =>
    runStandardsLint(io, options)
  );
}

export function registerStandardsCommand(program: Command, io: ProgramIO): void {
  const standards = program
    .command('standards')
    .description('Manage project-local coding standards');
  registerStandardsInitCommands(standards, io);
  registerStandardsMigrateCommand(standards, io);
  registerStandardsLintCommand(standards, io);
}
