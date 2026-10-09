import type { Command } from 'commander';
import { migrateStandards } from '../../../services/standards/migrate-service.js';
import { migrateClaudeRules } from '../../../services/standards/migrate-claude-rules-service.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../../cli-helpers.js';

type MigrateOptions = {
  project?: string;
  apply?: boolean;
  fromClaudeRules?: boolean;
  json?: boolean;
};

/** `--from-claude-rules`: thin `.claude/rules/` to pointers, scaffold `.peaks/standards/`. */
function runMigrateClaudeRules(io: ProgramIO, options: MigrateOptions, projectRoot: string): void {
  try {
    const result = migrateClaudeRules({ projectRoot, apply: options.apply === true });
    printResult(
      io,
      ok('standards.migrate', result.data, [], [...result.data.nextActions]),
      options.json
    );
  } catch (error: unknown) {
    printResult(
      io,
      fail(
        'standards.migrate',
        'STANDARDS_MIGRATE_FAILED',
        getErrorMessage(error),
        {
          backupPath: null,
          thinnedFiles: [],
          scaffoldedFiles: [],
          preservedFiles: [],
          wouldChange: false,
          applied: false,
          nextActions: []
        },
        [getErrorMessage(error)]
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

/** Default branch: rewrite the legacy heartbeat block in CLAUDE.md. */
function runMigrateLegacy(io: ProgramIO, options: MigrateOptions, projectRoot: string): void {
  try {
    const result = migrateStandards({ project: projectRoot, apply: options.apply === true });
    printResult(
      io,
      ok('standards.migrate', result.data, [], result.data.nextActions),
      options.json
    );
  } catch (error: unknown) {
    printResult(
      io,
      fail(
        'standards.migrate',
        'STANDARDS_MIGRATE_FAILED',
        getErrorMessage(error),
        {
          file: null,
          foundOldBlock: false,
          wouldChange: false,
          applied: false,
          before: null,
          after: null,
          nextActions: []
        },
        [getErrorMessage(error)]
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

export function registerStandardsMigrateCommand(standards: Command, io: ProgramIO): void {
  addJsonOption(
    standards
      .command('migrate')
      .description(
        'Rewrite a consumer project CLAUDE.md to drop the legacy heartbeat block (slice 028). Dry-run by default; pass --apply to write. With --from-claude-rules, thins the 1.x .claude/rules/ tree to 2-line pointers and scaffolds .peaks/standards/ (slice 2026-06-12-standards-migrate-claude-rules).'
      )
      .option('--project <path>', 'target project root')
      .option('--apply', 'rewrite the legacy block in place; default is dry-run')
      .option(
        '--from-claude-rules',
        'thin .claude/rules/ to pointers and scaffold .peaks/standards/'
      )
  ).action((options: MigrateOptions) => {
    const projectRoot = options.project ?? process.cwd();
    if (options.fromClaudeRules === true) {
      runMigrateClaudeRules(io, options, projectRoot);
      return;
    }
    runMigrateLegacy(io, options, projectRoot);
  });
}
