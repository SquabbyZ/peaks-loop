import type { Command } from 'commander';
import {
  summarizeProjectStandardsInitResult,
  summarizeProjectStandardsUpdateResult
} from '../../../services/standards/project-standards-service.js';
import {
  executeProjectStandardsInitIdeAware,
  executeProjectStandardsUpdateIdeAware
} from '../../../services/standards/ide-aware-standards-service.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../../cli-helpers.js';

/** The IDE ids the ide-aware executor accepts. */
type IdeId = 'claude-code' | 'trae' | 'codex' | 'cursor' | 'qoder' | 'tongyi-lingma';

type InitOptions = {
  project: string;
  language?: string;
  ide?: string;
  dryRun?: boolean;
  apply?: boolean;
  json?: boolean;
};

/** The five flags `init` and `update` share, in registration order. */
function withWriteFlags(cmd: Command, applyHelp: string): Command {
  return cmd
    .requiredOption('--project <path>', 'target project root')
    .option('--language <language>', 'standards language pack')
    .option('--ide <id>', 'override IDE detection (e.g. claude-code, trae)')
    .option('--dry-run', 'preview writes without changing files')
    .option('--apply', applyHelp);
}

/** The ide-aware request both verbs build from the same flag set. */
function buildIdeAwareRequest(options: InitOptions) {
  return {
    projectRoot: options.project,
    ...(options.language !== undefined ? { language: options.language } : {}),
    ...(options.ide !== undefined ? { ideId: options.ide as IdeId } : {}),
    apply: options.apply === true
  };
}

/** The verb-specific half of the `--dry-run --apply` refusal. */
type ConflictRefusal = { command: string; code: string; nextActions: string[] };

/** `--dry-run --apply` together is ambiguous; refuse before doing any work. */
function refuseConflictingFlags(
  io: ProgramIO,
  options: InitOptions,
  refusal: ConflictRefusal
): boolean {
  if (!(options.dryRun === true && options.apply === true)) return false;
  printResult(
    io,
    fail(
      refusal.command,
      refusal.code,
      'Use either --dry-run or --apply, not both',
      {},
      refusal.nextActions
    ),
    options.json
  );
  process.exitCode = 1;
  return true;
}

function runStandardsInit(io: ProgramIO, options: InitOptions): void {
  const refused = refuseConflictingFlags(io, options, {
    command: 'standards.init',
    code: 'INVALID_STANDARDS_INIT_FLAGS',
    nextActions: [
      'Run without --apply to preview writes, or omit --dry-run when applying standards'
    ]
  });
  if (refused) return;
  try {
    const result = executeProjectStandardsInitIdeAware(buildIdeAwareRequest(options));
    printResult(
      io,
      ok('standards.init', summarizeProjectStandardsInitResult(result)),
      options.json
    );
  } catch (error) {
    printResult(
      io,
      fail('standards.init', 'STANDARDS_INIT_FAILED', getErrorMessage(error), {}, [
        'Check the project path and existing .claude/rules directory before retrying'
      ]),
      options.json
    );
    process.exitCode = 1;
  }
}

function runStandardsUpdate(io: ProgramIO, options: InitOptions): void {
  const refused = refuseConflictingFlags(io, options, {
    command: 'standards.update',
    code: 'INVALID_STANDARDS_UPDATE_FLAGS',
    nextActions: [
      'Run without --apply to preview writes, or omit --dry-run when applying standards updates'
    ]
  });
  if (refused) return;
  try {
    const result = executeProjectStandardsUpdateIdeAware(buildIdeAwareRequest(options));
    const summary = summarizeProjectStandardsUpdateResult(result);
    const response =
      summary.reviewSuggestions.length > 0
        ? fail(
            'standards.update',
            'STANDARDS_UPDATE_REVIEW_REQUIRED',
            'Standards update requires manual review',
            summary,
            summary.reviewSuggestions
          )
        : ok('standards.update', summary);
    printResult(io, response, options.json);
    if (summary.reviewSuggestions.length > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    printResult(
      io,
      fail('standards.update', 'STANDARDS_UPDATE_FAILED', getErrorMessage(error), {}, [
        'Check the project path, CLAUDE.md contents, and existing .claude/rules directory before retrying'
      ]),
      options.json
    );
    process.exitCode = 1;
  }
}

export function registerStandardsInitCommands(standards: Command, io: ProgramIO): void {
  addJsonOption(
    withWriteFlags(
      standards
        .command('init')
        .description('Initialize project-local coding standards for Peaks skill preflight'),
      'write missing standards into the target project'
    )
  ).action((options: InitOptions) => runStandardsInit(io, options));

  addJsonOption(
    withWriteFlags(
      standards
        .command('update')
        .description(
          'Append managed standards metadata to an existing CLAUDE.md without rewriting the body'
        ),
      'append managed metadata to the target project'
    )
  ).action((options: InitOptions) => runStandardsUpdate(io, options));
}
