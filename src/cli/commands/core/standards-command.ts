import type { Command } from 'commander';
import { executeProjectStandardsInit, executeProjectStandardsUpdate, summarizeProjectStandardsInitResult, summarizeProjectStandardsUpdateResult } from '../../../services/standards/project-standards-service.js';
import { executeProjectStandardsInitIdeAware, executeProjectStandardsUpdateIdeAware } from '../../../services/standards/ide-aware-standards-service.js';
import { migrateStandards } from '../../../services/standards/migrate-service.js';
import { migrateClaudeRules } from '../../../services/standards/migrate-claude-rules-service.js';
import { detectProjectContext } from '../../../services/standards/project-context.js';
import { findSkillsForContext } from '../../../services/standards/find-skills-integration.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../../cli-helpers.js';

/**
 * Slice 4.0.7-PR-12 helper: render `npx skills find` results as
 * next-action strings the user can paste. Never auto-installs.
 * Returns an empty array when the network call fails (so the
 * init/update flow never blocks on find-skills).
 */
async function buildFindSkillsNextActions(projectRoot: string): Promise<string[]> {
  try {
    const ctx = detectProjectContext(projectRoot);
    const result = await findSkillsForContext(ctx, { topN: 5 });
    if (result.recommendations.length === 0) {
      return [`peaks-loop (PR-12): no matching skills found for this project stack; try \`npx skills find <query>\` manually.`];
    }
    const lines: string[] = ['peaks-loop (PR-12) skill recommendations (verified-owner first; install commands are copy-paste, never auto-run):'];
    for (const r of result.recommendations) {
      const count = r.installCount === null ? '?' : `${r.installCount.toLocaleString()} installs`;
      lines.push(`  ${r.displayName} (${r.owner}, ${count}) — ${r.installCommand}`);
    }
    if (result.failedRuns.length > 0) {
      lines.push(`peaks-loop (PR-12): ${result.failedRuns.length} find-skills run(s) failed (network or registry). Re-run \`npx skills find <query>\` to retry.`);
    }
    return lines;
  } catch {
    return [];
  }
}

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
      .option('--suggest-skills', 'Slice 4.0.7-PR-12: after init, query the open agent-skills ecosystem for matching skills and emit install commands. Off by default. Never auto-installs — user pastes the command.')
  ).action(async (options: { project: string; language?: string; ide?: string; dryRun?: boolean; apply?: boolean; suggestSkills?: boolean; json?: boolean }) => {
    if (options.dryRun === true && options.apply === true) {
      printResult(io, fail('standards.init', 'INVALID_STANDARDS_INIT_FLAGS', 'Use either --dry-run or --apply, not both', {}, ['Run without --apply to preview writes, or omit --dry-run when applying standards']), options.json);
      process.exitCode = 1;
      return;
    }

    try {
      const result = executeProjectStandardsInitIdeAware({ projectRoot: options.project, ...(options.language !== undefined ? { language: options.language } : {}), ...(options.ide !== undefined ? { ideId: options.ide as 'claude-code' | 'trae' | 'codex' | 'cursor' | 'qoder' | 'tongyi-lingma' } : {}), apply: options.apply === true });
      const summary = summarizeProjectStandardsInitResult(result);
      // Slice 4.0.7-PR-12: optional find-skills hint. Always
      // human-gated (we never invoke `npx skills add`); the user
      // pastes the install command. The slice is geared at
      // peaks-loop downstream projects — every project that runs
      // `peaks standards init` gets the same hint when the flag is
      // set, so consumers do not need to remember find-skills.
      const suggestNextActions = options.suggestSkills === true
        ? await buildFindSkillsNextActions(options.project)
        : [];
      printResult(
        io,
        ok('standards.init', summary, [], suggestNextActions),
        options.json
      );
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
      .option('--suggest-skills', 'Slice 4.0.7-PR-12: after update, refresh skill recommendations for the project stack. Off by default.')
  ).action(async (options: { project: string; language?: string; ide?: string; dryRun?: boolean; apply?: boolean; suggestSkills?: boolean; json?: boolean }) => {
    if (options.dryRun === true && options.apply === true) {
      printResult(io, fail('standards.update', 'INVALID_STANDARDS_UPDATE_FLAGS', 'Use either --dry-run or --apply, not both', {}, ['Run without --apply to preview writes, or omit --dry-run when applying standards updates']), options.json);
      process.exitCode = 1;
      return;
    }

    try {
      const result = executeProjectStandardsUpdateIdeAware({ projectRoot: options.project, ...(options.language !== undefined ? { language: options.language } : {}), ...(options.ide !== undefined ? { ideId: options.ide as 'claude-code' | 'trae' | 'codex' | 'cursor' | 'qoder' | 'tongyi-lingma' } : {}), apply: options.apply === true });
      const summary = summarizeProjectStandardsUpdateResult(result);
      const suggestNextActions = options.suggestSkills === true
        ? await buildFindSkillsNextActions(options.project)
        : [];
      const allNextActions = [...summary.reviewSuggestions, ...suggestNextActions];
      const response = summary.reviewSuggestions.length > 0
        ? fail('standards.update', 'STANDARDS_UPDATE_REVIEW_REQUIRED', 'Standards update requires manual review', summary, allNextActions)
        : ok('standards.update', summary, [], suggestNextActions);
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
