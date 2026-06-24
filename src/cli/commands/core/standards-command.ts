import type { Command } from 'commander';
import { executeProjectStandardsInit, executeProjectStandardsUpdate, summarizeProjectStandardsInitResult, summarizeProjectStandardsUpdateResult } from '../../../services/standards/project-standards-service.js';
import { executeProjectStandardsInitIdeAware, executeProjectStandardsUpdateIdeAware } from '../../../services/standards/ide-aware-standards-service.js';
import { migrateStandards } from '../../../services/standards/migrate-service.js';
import { migrateClaudeRules } from '../../../services/standards/migrate-claude-rules-service.js';
import { fail, ok } from '../../../shared/result.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../../cli-helpers.js';

export function registerStandardsCommand(program: Command, io: ProgramIO): void {
  const standards = program.command('standards').description('Manage project-local coding standards');
  addJsonOption(
    standards
      .command('init')
      .description('Initialize project-local coding standards for Peaks skill preflight')
      .requiredOption('--project <path>', 'target project root')
      .option('--language <language>', 'standards language pack')
      .option('--ide <id>', 'override IDE detection (e.g. claude-code, trae)')
      .option('--dry-run', 'preview writes without changing files')
      .option('--apply', 'write missing standards into the target project')
  ).action((options: { project: string; language?: string; ide?: string; dryRun?: boolean; apply?: boolean; json?: boolean }) => {
    if (options.dryRun === true && options.apply === true) {
      printResult(io, fail('standards.init', 'INVALID_STANDARDS_INIT_FLAGS', 'Use either --dry-run or --apply, not both', {}, ['Run without --apply to preview writes, or omit --dry-run when applying standards']), options.json);
      process.exitCode = 1;
      return;
    }

    try {
      const result = executeProjectStandardsInitIdeAware({ projectRoot: options.project, ...(options.language !== undefined ? { language: options.language } : {}), ...(options.ide !== undefined ? { ideId: options.ide as 'claude-code' | 'trae' | 'codex' | 'cursor' | 'qoder' | 'tongyi-lingma' } : {}), apply: options.apply === true });
      printResult(io, ok('standards.init', summarizeProjectStandardsInitResult(result)), options.json);
    } catch (error) {
      printResult(io, fail('standards.init', 'STANDARDS_INIT_FAILED', getErrorMessage(error), {}, ['Check the project path and existing .claude/rules directory before retrying']), options.json);
      process.exitCode = 1;
    }
  });
  addJsonOption(
    standards
      .command('update')
      .description('Append managed standards metadata to an existing CLAUDE.md without rewriting the body')
      .requiredOption('--project <path>', 'target project root')
      .option('--language <language>', 'standards language pack')
      .option('--ide <id>', 'override IDE detection (e.g. claude-code, trae)')
      .option('--dry-run', 'preview writes without changing files')
      .option('--apply', 'append managed metadata to the target project')
  ).action((options: { project: string; language?: string; ide?: string; dryRun?: boolean; apply?: boolean; json?: boolean }) => {
    if (options.dryRun === true && options.apply === true) {
      printResult(io, fail('standards.update', 'INVALID_STANDARDS_UPDATE_FLAGS', 'Use either --dry-run or --apply, not both', {}, ['Run without --apply to preview writes, or omit --dry-run when applying standards updates']), options.json);
      process.exitCode = 1;
      return;
    }

    try {
      const result = executeProjectStandardsUpdateIdeAware({ projectRoot: options.project, ...(options.language !== undefined ? { language: options.language } : {}), ...(options.ide !== undefined ? { ideId: options.ide as 'claude-code' | 'trae' | 'codex' | 'cursor' | 'qoder' | 'tongyi-lingma' } : {}), apply: options.apply === true });
      const summary = summarizeProjectStandardsUpdateResult(result);
      const response = summary.reviewSuggestions.length > 0
        ? fail('standards.update', 'STANDARDS_UPDATE_REVIEW_REQUIRED', 'Standards update requires manual review', summary, summary.reviewSuggestions)
        : ok('standards.update', summary);
      printResult(io, response, options.json);
      if (summary.reviewSuggestions.length > 0) {
        process.exitCode = 1;
      }
    } catch (error) {
      printResult(io, fail('standards.update', 'STANDARDS_UPDATE_FAILED', getErrorMessage(error), {}, ['Check the project path, CLAUDE.md contents, and existing .claude/rules directory before retrying']), options.json);
      process.exitCode = 1;
    }
  });
  addJsonOption(
    standards
      .command('migrate')
      .description('Rewrite a consumer project CLAUDE.md to drop the legacy heartbeat block (slice 028). Dry-run by default; pass --apply to write. With --from-claude-rules, thins the 1.x .claude/rules/ tree to 2-line pointers and scaffolds .peaks/standards/ (slice 2026-06-12-standards-migrate-claude-rules).')
      .option('--project <path>', 'target project root')
      .option('--apply', 'rewrite the legacy block in place; default is dry-run')
      .option('--from-claude-rules', 'thin .claude/rules/ to pointers and scaffold .peaks/standards/ (used by `peaks upgrade --to 2.0`)')
  ).action((options: { project?: string; apply?: boolean; fromClaudeRules?: boolean; json?: boolean }) => {
    const projectRoot = options.project ?? process.cwd();
    if (options.fromClaudeRules === true) {
      try {
        const result = migrateClaudeRules({ projectRoot, apply: options.apply === true });
        printResult(io, ok('standards.migrate', result.data, [], [...result.data.nextActions]), options.json);
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
              nextActions: [],
            },
            [getErrorMessage(error)]
          ),
          options.json
        );
        process.exitCode = 1;
      }
      return;
    }
    try {
      const result = migrateStandards({ project: projectRoot, apply: options.apply === true });
      printResult(io, ok('standards.migrate', result.data, [], result.data.nextActions), options.json);
    } catch (error: unknown) {
      printResult(io, fail('standards.migrate', 'STANDARDS_MIGRATE_FAILED', getErrorMessage(error), { file: null, foundOldBlock: false, wouldChange: false, applied: false, before: null, after: null, nextActions: [] }, [getErrorMessage(error)]), options.json);
      process.exitCode = 1;
    }
  });
}
