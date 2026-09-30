/**
 * `peaks retrospective search` — the search command, hoisted out of
 * `retrospective-commands.ts` so that file clears the 300 raw-line cap.
 *
 * Identical control flow: same filter predicates (in the same order), the
 * same optional-spread into `searchRetrospective`, the same envelope
 * fields, the same suggestion texts, the same `process.exitCode = 1`, and
 * the same catch shape (the failure is reported, never swallowed). The
 * filter checks and the failure envelope were split into single-purpose
 * helpers so no function here carries a `max-lines-per-function` or
 * `complexity` finding; nothing else was rewritten.
 *
 * `runRetrospectiveSearch` and `RetrospectiveSearchCommandOptions` stay
 * importable from `retrospective-commands.js` (public surface unchanged).
 */

import type { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';
import {
  searchRetrospective,
  type RetrospectiveOutcome,
  type RetrospectiveType
} from '../../services/retrospective/retrospective-search-service.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { resolveRetrospectiveProjectRoot } from './retrospective-project-root.js';

const VALID_RETRO_TYPES: ReadonlyArray<RetrospectiveType> = [
  'refactor',
  'feature',
  'bugfix',
  'config',
  'docs',
  'chore'
];
const VALID_RETRO_OUTCOMES: ReadonlyArray<RetrospectiveOutcome> = [
  'shipped',
  'blocked',
  'in-flight',
  'cancelled'
];

export interface RetrospectiveSearchCommandOptions {
  query: string;
  type?: string;
  outcome?: string;
  limit?: number;
  project?: string;
  json?: boolean;
}

function resolveTypeFilter(type: string | undefined): RetrospectiveType | undefined {
  return type !== undefined && VALID_RETRO_TYPES.includes(type as RetrospectiveType)
    ? (type as RetrospectiveType)
    : undefined;
}

function resolveOutcomeFilter(outcome: string | undefined): RetrospectiveOutcome | undefined {
  return outcome !== undefined && VALID_RETRO_OUTCOMES.includes(outcome as RetrospectiveOutcome)
    ? (outcome as RetrospectiveOutcome)
    : undefined;
}

function printSearchFailure(
  io: ProgramIO,
  options: RetrospectiveSearchCommandOptions,
  projectRoot: string,
  error: unknown
): void {
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

export function runRetrospectiveSearch(
  io: ProgramIO,
  options: RetrospectiveSearchCommandOptions
): void {
  const projectRoot = resolveRetrospectiveProjectRoot(options.project);

  const typeFilter = resolveTypeFilter(options.type);
  const outcomeFilter = resolveOutcomeFilter(options.outcome);

  try {
    const matches = searchRetrospective({
      query: options.query,
      projectRoot,
      ...(typeFilter !== undefined ? { type: typeFilter } : {}),
      ...(outcomeFilter !== undefined ? { outcome: outcomeFilter } : {}),
      ...(options.limit !== undefined ? { limit: options.limit } : {})
    });

    printResult(
      io,
      ok(
        'retrospective.search',
        {
          query: options.query,
          total: matches.length,
          matches,
          warnings: []
        },
        []
      ),
      options.json
    );
  } catch (error) {
    printSearchFailure(io, options, projectRoot, error);
  }
}

export function registerRetrospectiveSearchCommand(retrospective: Command, io: ProgramIO): void {
  addJsonOption(
    retrospective
      .command('search <query>')
      .description(
        'Fuzzy-search the retrospective index (deterministic, local, zero-token). Default --limit 6.'
      )
      .option(
        '--type <type>',
        `filter by retrospective type (one of: ${VALID_RETRO_TYPES.join(', ')})`
      )
      .option(
        '--outcome <outcome>',
        `filter by retrospective outcome (one of: ${VALID_RETRO_OUTCOMES.join(', ')})`
      )
      .option('--limit <n>', 'maximum number of matches to return', (value: string) =>
        Number(value)
      )
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
  ).action(
    (
      query: string,
      options: { type?: string; outcome?: string; limit?: number; project?: string; json?: boolean }
    ) => {
      runRetrospectiveSearch(io, {
        query,
        ...(options.type !== undefined ? { type: options.type } : {}),
        ...(options.outcome !== undefined ? { outcome: options.outcome } : {}),
        ...(options.limit !== undefined ? { limit: options.limit } : {}),
        ...(options.project !== undefined ? { project: options.project } : {}),
        ...(options.json !== undefined ? { json: options.json } : {})
      });
    }
  );
}
