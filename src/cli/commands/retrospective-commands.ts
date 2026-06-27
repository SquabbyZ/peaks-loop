import { Command } from 'commander';
import { join } from 'node:path';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { loadRetrospectiveIndex } from '../../services/retrospective/retrospective-index.js';
import { showRetrospective } from '../../services/retrospective/retrospective-show.js';
import { searchRetrospective, type RetrospectiveType, type RetrospectiveOutcome, type RetrospectiveEntry } from '../../services/retrospective/retrospective-search-service.js';
import { pickFromList } from '../../services/fuzzy-matching/fzf-pick-service.js';
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
      suggestions.push('Build a retrospective index.json in .peaks/retrospective/');
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
      .description('List all retrospective entries from .peaks/retrospective/index.json (R3: replaces the per-workflow MD dirs). Pass --pick to spawn fzf for interactive multi-select; the picked subset is written to .peaks/retrospective/picked.json.')
      .option('--pick', 'spawn fzf for interactive multi-select (requires fzf >= 0.38); writes picked.json')
      .option('--fzf-bin <path>', 'override fzf binary path (default: fzf on PATH)', 'fzf')
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
  ).action(async (options: { pick?: boolean; fzfBin?: string; project?: string; json?: boolean }) => {
    const projectRoot = options.project !== undefined
      ? resolveCanonicalProjectRoot(options.project)
      : (findProjectRoot(process.cwd()) ?? process.cwd());
    try {
      const result = loadRetrospectiveIndex(projectRoot);
      const warnings: string[] = result.warning === null ? [] : [result.warning];
      let picked: RetrospectiveEntry[] | null = null;
      let pickedOutputPath: string | null = null;
      let fzfVersion: string | null = null;

      if (options.pick === true) {
        const outputPath = join(projectRoot, '.peaks', 'retrospective', 'picked.json');
        const byId = new Map(result.entries.map((e) => [e.id, e] as const));
        const pickResult = await pickFromList<RetrospectiveEntry>({
          items: result.entries,
          formatLine: (e) => `${e.id} | ${e.type} | ${e.title} | ${e.outcome}`,
          parseLine: (line) => {
            const parts = line.split('|').map((p) => p.trim());
            if (parts.length < 1) return null;
            const id = parts[0];
            if (id === undefined || id.length === 0) return null;
            return byId.get(id) ?? null;
          },
          outputPath,
          meta: { totalCandidates: result.totalCount, source: result.source },
          ...(options.fzfBin !== undefined ? { fzfBin: options.fzfBin } : {}),
          projectRoot,
          multi: true,
          prompt: 'retrospective> '
        });
        picked = [...pickResult.picked];
        pickedOutputPath = pickResult.outputPath;
        fzfVersion = pickResult.fzfVersion;
      }

      printResult(
        io,
        ok('retrospective.index', {
          indexPath: result.indexPath,
          source: result.source,
          total: result.totalCount,
          entries: result.entries,
          ...(options.pick === true ? { picked, pickedOutputPath, fzfVersion } : {})
        }, warnings),
        options.json
      );
    } catch (error) {
      const msg = getErrorMessage(error);
      const isFzfError = /brew install fzf|apt-get install fzf|older than required/.test(msg);
      if (isFzfError) process.exitCode = 127;
      else process.exitCode = 1;
      printResult(
        io,
        fail(
          'retrospective.index',
          isFzfError ? 'FZF_UNAVAILABLE' : 'RETROSPECTIVE_INDEX_FAILED',
          msg,
          { projectRoot },
          isFzfError
            ? ['Install fzf (brew install fzf or apt-get install fzf) or run without --pick to list entries as JSON.']
            : ['Check the project path and .peaks/retrospective/index.json']
        ),
        options.json
      );
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
        if (result.code === 'INDEX_MISSING') suggestions.push('Build a retrospective index.json in .peaks/retrospective/');
        if (result.code === 'NOT_FOUND') suggestions.push('Run `peaks retrospective index --json` to see available ids');
        if (result.code === 'ARTIFACT_MISSING' || result.missingArtifacts !== undefined) {
          suggestions.push('Restore the missing artifact at the path listed under missingArtifacts');
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
