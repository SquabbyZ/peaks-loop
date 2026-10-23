import type { Command } from 'commander';
import {
  summarizeProjectStandardsInitResult,
  summarizeProjectStandardsUpdateResult
} from '../../../services/standards/project-standards-service.js';
import {
  executeProjectStandardsInitIdeAware,
  executeProjectStandardsUpdateIdeAware
} from '../../../services/standards/ide-aware-standards-service.js';
import type { IdeId } from '../../../services/ide/ide-types.js';
import { listAdapterIds } from '../../../services/ide/ide-registry.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../../cli-helpers.js';

/**
 * The registered IDE ids `--ide` accepts.
 *
 * Read from the registry rather than re-typed here: a hand-written list of
 * ids is a second copy of the registry, and the copy that shipped with this
 * command was missing `hermes`, `openclaw` and `zcode` — so `--ide zcode`
 * used to reach `getAdapter()` and throw instead of being accepted.
 */
const SUPPORTED_IDE_IDS: readonly IdeId[] = listAdapterIds();

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
    .option(
      '--ide <id>',
      `override IDE detection; the IDE's standards profile decides which instruction files are written (${SUPPORTED_IDE_IDS.join(
        ' | '
      )})`
    )
    .option('--dry-run', 'preview writes without changing files')
    .option('--apply', applyHelp);
}

/**
 * The `--ide` value, validated against the registry.
 *
 * `null` means "not a registered IDE" — the caller refuses with a
 * structured envelope instead of letting the value reach `getAdapter()`,
 * where an unknown id throws an unhandled error.
 */
function resolveIdeId(value: string | undefined): IdeId | null {
  if (value === undefined) return null;
  return SUPPORTED_IDE_IDS.find((id) => id === value) ?? null;
}

/** The ide-aware request both verbs build from the same flag set. */
function buildIdeAwareRequest(options: InitOptions, ideId: IdeId | null) {
  return {
    projectRoot: options.project,
    ...(options.language !== undefined ? { language: options.language } : {}),
    ...(ideId !== null ? { ideId } : {}),
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

/** Refuse an `--ide` value no adapter is registered under. */
function refuseUnknownIde(
  io: ProgramIO,
  options: InitOptions,
  command: string,
  ideId: IdeId | null
): boolean {
  if (options.ide === undefined || ideId !== null) return false;
  printResult(
    io,
    fail(
      command,
      'UNKNOWN_IDE',
      `Unknown IDE '${options.ide}'.`,
      { ide: options.ide, supportedIdeIds: SUPPORTED_IDE_IDS },
      [`Pass one of: ${SUPPORTED_IDE_IDS.join(', ')}.`]
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
  const ideId = resolveIdeId(options.ide);
  if (refuseUnknownIde(io, options, 'standards.init', ideId)) return;
  try {
    const result = executeProjectStandardsInitIdeAware(buildIdeAwareRequest(options, ideId));
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
  const ideId = resolveIdeId(options.ide);
  if (refuseUnknownIde(io, options, 'standards.update', ideId)) return;
  try {
    const result = executeProjectStandardsUpdateIdeAware(buildIdeAwareRequest(options, ideId));
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
        'Check the project path, AGENTS.md contents, and existing .claude/rules directory before retrying'
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
        .description(
          'Initialize project-local coding standards for Peaks skill preflight (AGENTS.md body + the CLAUDE.md pointer that imports it)'
        ),
      'write missing standards into the target project'
    )
  ).action((options: InitOptions) => runStandardsInit(io, options));

  addJsonOption(
    withWriteFlags(
      standards
        .command('update')
        .description(
          'Append managed standards metadata to the existing AGENTS.md / CLAUDE.md without rewriting their bodies'
        ),
      'append managed metadata to the target project'
    )
  ).action((options: InitOptions) => runStandardsUpdate(io, options));
}
