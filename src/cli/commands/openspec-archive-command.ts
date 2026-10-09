// src/cli/commands/openspec-archive-command.ts
//
// `peaks openspec archive <changeId>`. Extracted from `openspec-commands.ts`;
// the registered name, description, options and envelopes are unchanged.

import type { Command } from 'commander';
import {
  archiveOpenSpecChange,
  OpenSpecArchiveError
} from '../../services/openspec/openspec-archive-service.js';
import { ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  failOpenSpec,
  OPENSPEC_PATH_HINT,
  printArchiveError,
  printChangeNotFound,
  toArchiveOptions,
  type OpenSpecArchiveCommandOptions
} from './openspec-command-shared.js';

type ArchiveResult = NonNullable<Awaited<ReturnType<typeof archiveOpenSpecChange>>>;

/** The `--force` bypasses an archived run reports, in a fixed order. */
function archiveWarnings(result: ArchiveResult): string[] {
  const warnings: string[] = [];
  if (result.coverageGateBypassed === true) {
    warnings.push(
      'Coverage gate bypassed via --force; archived with at least one uncovered requirement.'
    );
  }
  if (result.coverageMismatchBypassed === true) {
    warnings.push(
      'Coverage summary mismatch bypassed via --force; archived with at least one capability below 100%.'
    );
  }
  return warnings;
}

const ARCHIVE_DESCRIPTION =
  'Move an OpenSpec change under openspec/changes/<archiveDir>/<id>/ (dry-run by default)';
const FORCE_DESCRIPTION =
  'bypass the Pre-cond 2 Coverage Evidence gate (use only after confirming the gap is acceptable for this archive)';
const COVERAGE_SUMMARY_DESCRIPTION =
  'override coverage-summary.json discovery (Fix-6B). Default: <projectRoot>/coverage/coverage-summary.json, then <projectRoot>/openspec/coverage-summary.json';

export function registerOpenSpecArchiveCommand(openspec: Command, io: ProgramIO): void {
  addJsonOption(
    openspec
      .command('archive')
      .description(ARCHIVE_DESCRIPTION)
      .argument('<changeId>', 'OpenSpec change directory name under openspec/changes')
      .option('--project <path>', 'project root containing an openspec/ directory')
      .option('--apply', 'actually move the change directory')
      .option('--force', FORCE_DESCRIPTION)
      .option('--coverage-summary <path>', COVERAGE_SUMMARY_DESCRIPTION)
      .option('--archive-dir <name>', 'archive subdirectory name (default: archive)')
  ).action(async (changeId: string, options: OpenSpecArchiveCommandOptions) => {
    try {
      const result = await archiveOpenSpecChange(
        changeId,
        toArchiveOptions(options.project, options)
      );
      if (result === null) {
        printChangeNotFound(io, 'openspec.archive', changeId, options.json);
        return;
      }
      printResult(
        io,
        ok(
          'openspec.archive',
          result,
          archiveWarnings(result),
          result.applied ? [] : [`Re-run with --apply to move ${result.from} → ${result.to}`]
        ),
        options.json
      );
    } catch (error) {
      if (error instanceof OpenSpecArchiveError) {
        printArchiveError(io, error, options.json);
        return;
      }
      failOpenSpec(io, 'openspec.archive', {
        code: 'OPENSPEC_ARCHIVE_FAILED',
        error,
        data: { changeId },
        nextActions: OPENSPEC_PATH_HINT,
        json: options.json
      });
    }
  });
}
