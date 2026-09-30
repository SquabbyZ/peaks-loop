/**
 * `peaks retrospective show <id>` — the show command, hoisted out of
 * `retrospective-commands.ts` so that file clears the 300 raw-line cap.
 *
 * Identical control flow: same project-root resolution, the same
 * `--pretty` → format ternary, the same `!result.ok` branch first (its
 * three suggestion checks in the same order with the same texts, then
 * `process.exitCode = 1`, then `return`), the same success envelope field
 * order, and the same catch with its own code / suggestion text / exit
 * code. The suggestion list, the failure `data` object and the success
 * payload became one-builder-each so the action itself is under
 * `max-lines-per-function` and `complexity`; the builders are pure and
 * emit the same bytes.
 */

import type { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';
import {
  showRetrospective,
  type RetrospectiveShowError,
  type RetrospectiveShowSuccess
} from '../../services/retrospective/retrospective-show.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { resolveRetrospectiveProjectRoot } from './retrospective-project-root.js';

export interface RetrospectiveShowCommandOptions {
  project?: string;
  pretty?: boolean;
  json?: boolean;
}

function buildShowFailureSuggestions(result: RetrospectiveShowError): string[] {
  const suggestions: string[] = [];
  if (result.code === 'INDEX_MISSING')
    suggestions.push('Build a retrospective index.json in .peaks/retrospective/');
  if (result.code === 'NOT_FOUND')
    suggestions.push('Run `peaks retrospective index --json` to see available ids');
  if (result.code === 'ARTIFACT_MISSING' || result.missingArtifacts !== undefined) {
    suggestions.push('Restore the missing artifact at the path listed under missingArtifacts');
  }
  return suggestions;
}

function buildShowFailureData(id: string, projectRoot: string, result: RetrospectiveShowError) {
  return {
    id,
    projectRoot,
    ...(result.missingArtifacts !== undefined ? { missingArtifacts: result.missingArtifacts } : {})
  };
}

function buildShowSuccessPayload(result: RetrospectiveShowSuccess) {
  return {
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
  };
}

export function runRetrospectiveShowAction(
  io: ProgramIO,
  id: string,
  options: RetrospectiveShowCommandOptions
): void {
  const projectRoot = resolveRetrospectiveProjectRoot(options.project);
  try {
    const format: 'compact' | 'pretty' = options.pretty === true ? 'pretty' : 'compact';
    const result = showRetrospective({ projectRoot, id, format });
    if (!result.ok) {
      const suggestions = buildShowFailureSuggestions(result);
      printResult(
        io,
        fail(
          'retrospective.show',
          result.code,
          result.message,
          buildShowFailureData(id, projectRoot, result),
          suggestions
        ),
        options.json
      );
      process.exitCode = 1;
      return;
    }
    printResult(
      io,
      ok('retrospective.show', buildShowSuccessPayload(result), result.warnings),
      options.json
    );
  } catch (error) {
    printResult(
      io,
      fail(
        'retrospective.show',
        'RETROSPECTIVE_SHOW_FAILED',
        getErrorMessage(error),
        { id, projectRoot },
        ['Check the project path and id']
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

export function registerRetrospectiveShowCommand(retrospective: Command, io: ProgramIO): void {
  addJsonOption(
    retrospective
      .command('show <id>')
      .description(
        'Show one retrospective entry by id. Default format is `compact` (LLM-primary); pass --pretty to get the disk / re-hydrated pretty form.'
      )
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
      .option(
        '--pretty',
        'return the pretty form (re-hydrated from source artifacts); overrides the compact default'
      )
  ).action((id: string, options: RetrospectiveShowCommandOptions) => {
    runRetrospectiveShowAction(io, id, options);
  });
}
