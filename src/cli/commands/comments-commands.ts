/**
 * `peaks comments` — the read side of comment hygiene.
 *
 * `peaks comments audit` reports which comments in the product scope assert
 * something the repository no longer supports, and which are development
 * narrative rather than documentation. It is read-only on purpose: the number it
 * prints is the number a later ratchet would be seeded from, and a ceiling is
 * only trustworthy once a human has read a list of what the rule flags.
 *
 * Remediation is the next slice's job, not this command's.
 */

import type { Command } from 'commander';

import { auditComments, type CommentAuditResult } from '../../services/comments/comment-audit.js';
import type { CommentFindingKind } from '../../services/comments/comment-hygiene.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';

const KINDS: readonly CommentFindingKind[] = ['dead-reference', 'narrative'];

function parseKind(value: string | undefined): CommentFindingKind | undefined {
  return KINDS.find((kind) => kind === value);
}

function nextActions(result: CommentAuditResult): string[] {
  const lines = [
    `dead-reference: ${result.deadReferences} comment line(s) cite a path that resolves nowhere.`,
    `narrative: ${result.narrative} comment line(s) are about the work, not the code.`
  ];
  if (result.deadReferences > 0) {
    lines.push(
      'Fix the citation or delete the claim — a comment that names a deleted file is an instruction to go look for it.'
    );
  }
  lines.push('Worst files first: --json carries per-line records with the matched rule.');
  return lines;
}

type AuditOptions = { project?: string; kind?: string; limit?: string; json?: boolean };

/** The `audit` action, named so the registration above stays a registration. */
function runAudit(io: ProgramIO, options: AuditOptions): void {
  const projectRoot = options.project ?? process.cwd();
  const kind = parseKind(options.kind);
  if (options.kind !== undefined && kind === undefined) {
    printResult(
      io,
      fail(
        'comments.audit',
        'INVALID_KIND',
        `--kind must be one of: ${KINDS.join(', ')}`,
        { provided: options.kind },
        ['Re-run with a supported --kind, or omit it to scan both.']
      ),
      options.json === true
    );
    process.exitCode = 1;
    return;
  }
  try {
    const limit = options.limit === undefined ? undefined : Number.parseInt(options.limit, 10);
    const result = auditComments({
      projectRoot,
      ...(kind === undefined ? {} : { kind }),
      ...(limit === undefined || Number.isNaN(limit) ? {} : { limit })
    });
    printResult(io, ok('comments.audit', result, [], nextActions(result)), options.json === true);
  } catch (error: unknown) {
    printResult(
      io,
      fail('comments.audit', 'COMMENTS_AUDIT_FAILED', getErrorMessage(error), {}, [
        'Check --project points at a repository root.'
      ]),
      options.json === true
    );
    process.exitCode = 1;
  }
}

export function registerCommentsCommands(program: Command, io: ProgramIO): void {
  const comments = program
    .command('comments')
    .description('Measure comment debt in product code: stale references and process narrative.');

  addJsonOption(
    comments
      .command('audit')
      .description('Read-only scan of src/** and packages/*/src/** comments.')
      .option('--project <path>', 'project root to scan (default: cwd)')
      .option('--kind <kind>', `one of: ${KINDS.join(', ')}`)
      .option('--limit <n>', 'cap the per-line findings printed (totals are never capped)')
  ).action((options: AuditOptions) => runAudit(io, options));
}
