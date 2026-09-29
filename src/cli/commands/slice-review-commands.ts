/**
 * v2.15.0 follow-up — G1: slice business review CLI.
 *
 *   - `peaks slice review <slice-id>`      — show the 4-5 business
 *                                            review items for a slice
 *                                            (template; user scores 1-5)
 *   - `peaks slice score <slice-id> --item <id> --score <1-5>`
 *                                          — record a single item's
 *                                            score
 *   - `peaks slice accept <slice-id>`       — mark the slice as
 *                                            accepted (must have all
 *                                            items scored first)
 *   - `peaks slice reject <slice-id> --reason <text>`
 *                                          — mark as rejected with a
 *                                            reason (back to RD repair)
 *
 * The 12 Gaps positioning memory: user reviews BUSINESS / PRODUCT,
 * not technical metrics (which are AI auto-decided in peaks-rd's
 * fan-out).
 */

import type { Command } from 'commander';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';
import {
  acceptReview,
  buildEmptySliceReview,
  DEFAULT_REVIEW_ITEMS,
  deriveDecision,
  readSliceReview,
  rejectReview,
  renderChecklist,
  scoreItem,
  writeSliceReview
} from '../../services/slice/slice-review-state.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';

import {
  PENDING_SCORE_HINTS,
  renderRejectionNotes,
  SLICE_ACCEPT_DESCRIPTION,
  SLICE_REJECT_DESCRIPTION,
  SLICE_REVIEW_DESCRIPTION,
  SLICE_SCORE_DESCRIPTION,
  type SliceRejectOpts,
  type SliceScoreOpts
} from './slice-review-commands-helpers.js';

export function registerSliceReviewCommands(program: Command, io: ProgramIO): void {
  // G1 commands registered as TOP-LEVEL commands prefixed with `slice-review-`
  // to avoid colliding with the existing `peaks slice` commands
  // (registered by slice-commands.ts). Same approach as user-touchpoint
  // and qa-business-review commands.

  // 1. review
  addJsonOption(
    program
      .command('slice-review <slice-id>')
      .description(SLICE_REVIEW_DESCRIPTION)
      .option('--session-id <sid>', 'session id (default: read from .peaks/_runtime/session.json)')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((sliceId: string, opts: { sessionId?: string; project?: string; json?: boolean }) => {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const sessionId = opts.sessionId ?? getCurrentSessionId(projectRoot) ?? 'unknown-sid';
    let review = readSliceReview(projectRoot, sessionId, sliceId);
    if (review === null) {
      review = buildEmptySliceReview(sliceId, sessionId);
      writeSliceReview(projectRoot, review);
    }
    const checklist = renderChecklist(review);
    printResult(
      io,
      ok(
        'slice.review',
        {
          sessionId,
          sliceId,
          decision: review.decision,
          derivedDecision: deriveDecision(review),
          items: checklist,
          averageScore:
            review.items.filter((it) => it.score !== null).length === 0
              ? null
              : review.items.reduce((s, it) => s + (it.score ?? 0), 0) /
                review.items.filter((it) => it.score !== null).length
        },
        review.decision === 'pending' ? PENDING_SCORE_HINTS : [],
        review.decision === 'rejected' ? renderRejectionNotes(review.rejectionReason) : []
      ),
      opts.json ?? false
    );
  });

  // 2. score
  addJsonOption(
    program
      .command('slice-score <slice-id>')
      .description(SLICE_SCORE_DESCRIPTION)
      .requiredOption(
        '--item <id>',
        'item id (e.g. business-match / boundary-cases / ui-assembly / mergeable)'
      )
      .requiredOption('--score <1-5>', 'score (1-5)')
      .option('--note <text>', 'optional note (e.g. "fix the auth flow first")')
      .option('--session-id <sid>', 'session id (default: read from .peaks/_runtime/session.json)')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((sliceId: string, opts: SliceScoreOpts) => {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const sessionId = opts.sessionId ?? getCurrentSessionId(projectRoot) ?? 'unknown-sid';
    const score = Number.parseInt(opts.score, 10);
    if (Number.isNaN(score) || score < 1 || score > 5) {
      printResult(
        io,
        fail(
          'slice.score',
          'INVALID_SCORE',
          `--score must be 1-5 (got "${opts.score}")`,
          { projectRoot },
          []
        ),
        opts.json ?? false
      );
      process.exitCode = 1;
      return;
    }
    let review = readSliceReview(projectRoot, sessionId, sliceId);
    if (review === null) {
      review = buildEmptySliceReview(sliceId, sessionId);
    }
    const validItemIds = DEFAULT_REVIEW_ITEMS.map((it) => it.id);
    if (!validItemIds.includes(opts.item)) {
      printResult(
        io,
        fail(
          'slice.score',
          'UNKNOWN_ITEM',
          `unknown item "${opts.item}" (valid: ${validItemIds.join(', ')})`,
          { projectRoot },
          []
        ),
        opts.json ?? false
      );
      process.exitCode = 1;
      return;
    }
    const next = scoreItem(review, opts.item, score, opts.note);
    writeSliceReview(projectRoot, next);
    printResult(
      io,
      ok(
        'slice.score',
        {
          sessionId,
          sliceId,
          item: opts.item,
          score,
          derivedDecision: deriveDecision(next)
        },
        [],
        [
          deriveDecision(next) === 'accepted'
            ? 'All items now average >= 3 with no item <= 2. Run `peaks slice accept` to confirm.'
            : 'Score recorded. Continue scoring other items or run `peaks slice accept` / `peaks slice reject`.'
        ]
      ),
      opts.json ?? false
    );
  });

  // 3. accept
  addJsonOption(
    program
      .command('slice-accept <slice-id>')
      .description(SLICE_ACCEPT_DESCRIPTION)
      .option('--session-id <sid>', 'session id')
      .option('--project <path>', 'project root')
  ).action((sliceId: string, opts: { sessionId?: string; project?: string; json?: boolean }) => {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const sessionId = opts.sessionId ?? getCurrentSessionId(projectRoot) ?? 'unknown-sid';
    const review = readSliceReview(projectRoot, sessionId, sliceId);
    if (review === null) {
      printResult(
        io,
        fail(
          'slice.accept',
          'NO_REVIEW',
          `no review found for slice "${sliceId}" — run peaks slice review first`,
          { projectRoot },
          []
        ),
        opts.json ?? false
      );
      process.exitCode = 1;
      return;
    }
    const derived = deriveDecision(review);
    if (derived === 'rejected') {
      printResult(
        io,
        fail(
          'slice.accept',
          'CANNOT_ACCEPT',
          `derived decision is "rejected" (avg < 3 or item <= 2). Run peaks slice reject instead.`,
          { projectRoot, review },
          []
        ),
        opts.json ?? false
      );
      process.exitCode = 1;
      return;
    }
    if (derived === 'pending') {
      const pending = review.items.filter((it) => it.score === null).map((it) => it.id);
      printResult(
        io,
        fail(
          'slice.accept',
          'PENDING',
          `not all items are scored (pending: ${pending.join(', ')})`,
          { projectRoot, review },
          []
        ),
        opts.json ?? false
      );
      process.exitCode = 1;
      return;
    }
    const next = acceptReview(review);
    writeSliceReview(projectRoot, next);
    printResult(
      io,
      ok(
        'slice.accept',
        { sessionId, sliceId, decision: 'accepted', updatedAt: next.updatedAt },
        [],
        ['Slice accepted. Proceed to the next slice / final review.']
      ),
      opts.json ?? false
    );
  });

  // 4. reject
  addJsonOption(
    program
      .command('slice-reject <slice-id>')
      .description(SLICE_REJECT_DESCRIPTION)
      .requiredOption('--reason <text>', 'rejection reason (required)')
      .option('--session-id <sid>', 'session id')
      .option('--project <path>', 'project root')
  ).action((sliceId: string, opts: SliceRejectOpts) => {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const sessionId = opts.sessionId ?? getCurrentSessionId(projectRoot) ?? 'unknown-sid';
    const review = readSliceReview(projectRoot, sessionId, sliceId);
    if (review === null) {
      printResult(
        io,
        fail(
          'slice.reject',
          'NO_REVIEW',
          `no review found for slice "${sliceId}"`,
          { projectRoot },
          []
        ),
        opts.json ?? false
      );
      process.exitCode = 1;
      return;
    }
    const next = rejectReview(review, opts.reason);
    writeSliceReview(projectRoot, next);
    printResult(
      io,
      ok(
        'slice.reject',
        {
          sessionId,
          sliceId,
          decision: 'rejected',
          reason: opts.reason,
          updatedAt: next.updatedAt
        },
        [],
        ['Slice rejected. Hand back to peaks-rd repair-loop.']
      ),
      opts.json ?? false
    );
  });
}
