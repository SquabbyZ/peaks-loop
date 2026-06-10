import { Command } from 'commander';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { loadRetrospectiveIndex } from '../../services/retrospective/retrospective-index.js';
import { showRetrospective } from '../../services/retrospective/retrospective-show.js';
import { migrateRetrospectiveFromMd } from '../../services/retrospective/migrate-from-md.js';
import { searchRetrospective, type RetrospectiveType, type RetrospectiveOutcome } from '../../services/retrospective/retrospective-search-service.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

const VALID_RETRO_TYPES: ReadonlyArray<RetrospectiveType> = ['refactor', 'feature', 'bugfix', 'config', 'docs', 'chore'];
const VALID_RETRO_OUTCOMES: ReadonlyArray<RetrospectiveOutcome> = ['shipped', 'blocked', 'in-flight', 'cancelled'];

export interface RetrospectiveSearchCommandOptions {
  query: string;
  type?: string;
  outcome?: string;
  limit?: number;
  project?: string;
  json?: boolean;
}

export function runRetrospectiveSearch(io: ProgramIO, options: RetrospectiveSearchCommandOptions): void {
  const projectRoot = options.project !== undefined
    ? resolveCanonicalProjectRoot(options.project)
    : (findProjectRoot(process.cwd()) ?? process.cwd());

  const typeFilter = options.type !== undefined && VALID_RETRO_TYPES.includes(options.type as RetrospectiveType)
    ? (options.type as RetrospectiveType)
    : undefined;
  const outcomeFilter = options.outcome !== undefined && VALID_RETRO_OUTCOMES.includes(options.outcome as RetrospectiveOutcome)
    ? (options.outcome as RetrospectiveOutcome)
    : undefined;

  try {
    const matches = searchRetrospective({
      query: options.query,
      projectRoot,
      ...(typeFilter !== undefined ? { type: typeFilter } : {}),
      ...(outcomeFilter !== undefined ? { outcome: outcomeFilter } : {}),
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
    });

    printResult(
      io,
      ok(
        'retrospective.search',
        {
          query: options.query,
          total: matches.length,
          matches,
          warnings: [],
        },
        []
      ),
      options.json
    );
  } catch (error) {
    const message = getErrorMessage(error);
    const code = (error as { code?: string }).code ?? 'RETROSPECTIVE_SEARCH_FAILED';
    const suggestions: string[] = [];
    if (code === 'INDEX_MISSING') {
      suggestions.push('Run `peaks retrospective migrate --apply` to build the index from legacy MDs');
    }
    if (code === 'EMPTY_QUERY') {
      suggestions.push('Use `peaks retrospective index` to list all entries');
    }
    printResult(
      io,
      fail('retrospective.search', code, message, { projectRoot, query: options.query }, suggestions),
      options.json
    );
    process.exitCode = 1;
  }
}

export function registerRetrospectiveCommands(program: Command, io: ProgramIO): void {
  const retrospective = program.command('retrospective').description('Read the peaks retrospective index (R3: index.json, not the legacy <id>/ MD tree)');

  addJsonOption(
    retrospective
      .command('index')
      .description('List all retrospective entries from .peaks/retrospective/index.json (R3: replaces the per-workflow MD dirs)')
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
  ).action((options: { project?: string; json?: boolean }) => {
    const projectRoot = options.project !== undefined
      ? resolveCanonicalProjectRoot(options.project)
      : (findProjectRoot(process.cwd()) ?? process.cwd());
    try {
      const result = loadRetrospectiveIndex(projectRoot);
      const warnings: string[] = result.warning === null ? [] : [result.warning];
      printResult(
        io,
        ok('retrospective.index', {
          indexPath: result.indexPath,
          source: result.source,
          total: result.totalCount,
          entries: result.entries
        }, warnings),
        options.json
      );
    } catch (error) {
      printResult(io, fail('retrospective.index', 'RETROSPECTIVE_INDEX_FAILED', getErrorMessage(error), { projectRoot }, ['Check the project path and .peaks/retrospective/index.json']), options.json);
      process.exitCode = 1;
    }
  });

  addJsonOption(
    retrospective
      .command('show <id>')
      .description('Show one retrospective entry by id. Default format is `compact` (LLM-primary); pass --pretty to get the disk / re-hydrated pretty form.')
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
      .option('--pretty', 'return the pretty form (re-hydrated from source artifacts); overrides the compact default')
  ).action((id: string, options: { project?: string; pretty?: boolean; json?: boolean }) => {
    const projectRoot = options.project !== undefined
      ? resolveCanonicalProjectRoot(options.project)
      : (findProjectRoot(process.cwd()) ?? process.cwd());
    try {
      const format: 'compact' | 'pretty' = options.pretty === true ? 'pretty' : 'compact';
      const result = showRetrospective({ projectRoot, id, format });
      if (!result.ok) {
        const suggestions: string[] = [];
        if (result.code === 'INDEX_MISSING') suggestions.push('Run `peaks retrospective migrate --apply` to build the index');
        if (result.code === 'NOT_FOUND') suggestions.push('Run `peaks retrospective index --json` to see available ids');
        if (result.code === 'ARTIFACT_MISSING' || result.missingArtifacts !== undefined) {
          suggestions.push('Re-hydrate from the legacy archive at .peaks/_archive/retrospective-2026-06-09-pre-r3.tar.gz');
        }
        printResult(io, fail('retrospective.show', result.code, result.message, { id, projectRoot, ...(result.missingArtifacts !== undefined ? { missingArtifacts: result.missingArtifacts } : {}) }, suggestions), options.json);
        process.exitCode = 1;
        return;
      }
      printResult(
        io,
        ok('retrospective.show', {
          id: result.entry.id,
          sessionId: result.entry.sessionId,
          sliceId: result.entry.sliceId ?? null,
          type: result.entry.type,
          title: result.entry.title,
          summary: result.entry.summary,
          outcome: result.entry.outcome,
          keyDecisions: result.entry.keyDecisions,
          lessonsLearned: result.entry.lessonsLearned,
          artifactPaths: result.entry.artifactPaths,
          updatedAt: result.entry.updatedAt,
          body: result.body,
          format: result.format
        }, result.warnings),
        options.json
      );
    } catch (error) {
      printResult(io, fail('retrospective.show', 'RETROSPECTIVE_SHOW_FAILED', getErrorMessage(error), { id, projectRoot }, ['Check the project path and id']), options.json);
      process.exitCode = 1;
    }
  });

  addJsonOption(
    retrospective
      .command('migrate')
      .description('One-time migration from per-workflow .peaks/retrospective/<id>/*.md dirs to a single .peaks/retrospective/index.json + .peaks/_archive/retrospective-2026-06-09-pre-r3.tar.gz archive. Dry-run by default; --apply is destructive.')
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
      .option('--apply', 'write the index.json + archive + delete legacy MDs (default: dry-run preview)')
      .option('--include-failed', 'include malformed MDs as best-effort entries; default is to skip + warn')
      .option('--expected-entries <n>', 'override the default expected entry count (88) for the no-op check', (value: string) => Number(value))
  ).action((options: { project?: string; apply?: boolean; includeFailed?: boolean; expectedEntries?: number; json?: boolean }) => {
    const projectRoot = options.project !== undefined
      ? resolveCanonicalProjectRoot(options.project)
      : (findProjectRoot(process.cwd()) ?? process.cwd());
    try {
      const result = migrateRetrospectiveFromMd({
        projectRoot,
        apply: options.apply === true,
        includeFailed: options.includeFailed === true,
        ...(options.expectedEntries !== undefined && Number.isFinite(options.expectedEntries) ? { expectedEntries: options.expectedEntries } : {})
      });
      const exitCode = result.status === 'failed' ? 1 : 0;
      printResult(
        io,
        ok('retrospective.migrate', {
          status: result.status,
          indexPath: result.indexPath,
          archivePath: result.archivePath,
          totalLegacyDirs: result.totalLegacyDirs,
          totalLegacyMds: result.totalLegacyMds,
          parsedEntries: result.parsedEntries,
          failedEntries: result.failedEntries,
          archiveVerified: result.archiveVerified
        }, result.warnings),
        options.json
      );
      if (exitCode !== 0) process.exitCode = exitCode;
    } catch (error) {
      printResult(io, fail('retrospective.migrate', 'RETROSPECTIVE_MIGRATE_FAILED', getErrorMessage(error), { projectRoot }, ['Check the project path and .peaks/retrospective/ directory']), options.json);
      process.exitCode = 1;
    }
  });

  addJsonOption(
    retrospective
      .command('search <query>')
      .description('Fuzzy-search the retrospective index (deterministic, local, zero-token). Default --limit 6.')
      .option('--type <type>', `filter by retrospective type (one of: ${VALID_RETRO_TYPES.join(', ')})`)
      .option('--outcome <outcome>', `filter by retrospective outcome (one of: ${VALID_RETRO_OUTCOMES.join(', ')})`)
      .option('--limit <n>', 'maximum number of matches to return', (value: string) => Number(value))
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
  ).action((query: string, options: { type?: string; outcome?: string; limit?: number; project?: string; json?: boolean }) => {
    runRetrospectiveSearch(io, {
      query,
      ...(options.type !== undefined ? { type: options.type } : {}),
      ...(options.outcome !== undefined ? { outcome: options.outcome } : {}),
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
      ...(options.project !== undefined ? { project: options.project } : {}),
      ...(options.json !== undefined ? { json: options.json } : {}),
    });
  });
}
