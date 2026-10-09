// src/cli/commands/openspec-validate-command.ts
//
// `peaks openspec validate <changeId>`. Extracted from `openspec-commands.ts`;
// the registered name, description, options and envelopes are unchanged.

import type { Command } from 'commander';
import { validateOpenSpecChange } from '../../services/openspec/openspec-validate-service.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  failOpenSpec,
  OPENSPEC_PATH_HINT,
  printChangeNotFound,
  toValidateOptions,
  type OpenSpecValidateCommandOptions
} from './openspec-command-shared.js';

type ValidationResult = NonNullable<Awaited<ReturnType<typeof validateOpenSpecChange>>>;

/** The `openspec.validate` failure shape for a change that did not validate. */
function printValidateInvalid(
  io: ProgramIO,
  changeId: string,
  result: ValidationResult,
  json: boolean | undefined
): void {
  printResult(
    io,
    fail(
      'openspec.validate',
      'OPENSPEC_VALIDATE_INVALID',
      `OpenSpec change ${changeId} failed validation`,
      result,
      result.issues.map((issue) => `${issue.level}: ${issue.rule}: ${issue.message}`)
    ),
    json
  );
  process.exitCode = 1;
}

export function registerOpenSpecValidateCommand(openspec: Command, io: ProgramIO): void {
  addJsonOption(
    openspec
      .command('validate')
      .description(
        'Validate an OpenSpec change against internal lint rules (and optionally the external openspec CLI)'
      )
      .argument('<changeId>', 'OpenSpec change directory name under openspec/changes')
      .option('--project <path>', 'project root containing an openspec/ directory')
      .option(
        '--prefer-external',
        'use the external openspec CLI when available, fall back to internal lint'
      )
  ).action(async (changeId: string, options: OpenSpecValidateCommandOptions) => {
    try {
      const result = await validateOpenSpecChange(
        changeId,
        toValidateOptions(options.project, options)
      );
      if (result === null) {
        printChangeNotFound(io, 'openspec.validate', changeId, options.json);
        return;
      }
      if (!result.valid) {
        printValidateInvalid(io, changeId, result, options.json);
        return;
      }
      printResult(
        io,
        ok(
          'openspec.validate',
          result,
          result.issues
            .filter((issue) => issue.level === 'warning')
            .map((issue) => `${issue.rule}: ${issue.message}`)
        ),
        options.json
      );
    } catch (error) {
      failOpenSpec(io, 'openspec.validate', {
        code: 'OPENSPEC_VALIDATE_FAILED',
        error,
        data: { changeId },
        nextActions: OPENSPEC_PATH_HINT,
        json: options.json
      });
    }
  });
}
