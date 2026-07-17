/**
 * v2.15.0 follow-up — G5: QA business-perspective review CLI.
 *
 *   - `peaks qa business-review <request-id>`        — show the 6-item
 *                                                    business checklist
 *   - `peaks qa business-score <rid> --item --score` — record a single
 *                                                    item score (1-5)
 *   - `peaks qa business-accept <rid>`              — mark accepted
 *   - `peaks qa business-reject <rid> --reason`     — mark rejected
 *
 * The 12 Gaps positioning memory: QA business layer (user reviews
 * 6 product items) is decoupled from QA technical layer (AI
 * auto-decides coverage / P99 / security).
 */

import type { Command } from 'commander';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';
import {
  acceptQaReview,
  buildEmptyQaReview,
  deriveQaDecision,
  QA_BUSINESS_ITEMS,
  readQaReview,
  rejectQaReview,
  scoreQaItem,
  writeQaReview
} from '../../services/qa/qa-business-review-state.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';

export function registerQaBusinessReviewCommands(program: Command, io: ProgramIO): void {
  // G5 commands registered as TOP-LEVEL commands prefixed with `qa-business-`
  // to avoid colliding with the existing `peaks qa` role commands
  // (registered by qa-commands.ts, used for qa subcommands on qa artifacts).
  // See similar approach in user-touchpoint-commands.ts.

  // 1. business-review
  addJsonOption(
    program
      .command('qa-business-review <request-id>')
      .description(
        'Show the 6-item business checklist for a request (the 12 Gaps ' +
          'QA perspective). If no review exists, a new one is created ' +
          '(pending state).'
      )
      .option('--session-id <sid>', 'session id (default: read from .peaks/_runtime/session.json)')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((requestId: string, opts: { sessionId?: string; project?: string; json?: boolean }) => {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const sessionId = opts.sessionId ?? getCurrentSessionId(projectRoot) ?? 'unknown-sid';
    let review = readQaReview(projectRoot, sessionId, requestId);
    if (review === null) {
      review = buildEmptyQaReview(requestId, sessionId);
      writeQaReview(projectRoot, review);
    }
    const scoredCount = review.items.filter((it) => it.score !== null).length;
    const avg = review.items.filter((it) => it.score !== null).length === 0
      ? null
      : review.items.reduce((s, it) => s + (it.score ?? 0), 0) / scoredCount;
    printResult(io, ok('qa.business-review', {
      sessionId,
      requestId,
      decision: review.decision,
      derivedDecision: deriveQaDecision(review),
      items: review.items,
      scoredCount,
      averageScore: avg
    }, review.decision === 'pending' ? [
      `Score each item with: peaks qa business-score <rid> --item <id> --score <1-5>`,
      'When all items are scored, run: peaks qa business-accept <rid>'
    ] : [], review.decision === 'rejected' ? [
      `Rejected: ${review.rejectionReason ?? '(no reason)'}`
    ] : []), opts.json ?? false);
  });

  // 2. business-score
  addJsonOption(
    program
      .command('qa-business-score <request-id>')
      .description(
        'Record a single business item score (1-5). Threshold: avg >= 3 ' +
          'AND no item <= 2 → accepted; otherwise rejected.'
      )
      .requiredOption('--item <id>', `item id (${QA_BUSINESS_ITEMS.map((i) => i.id).join(' | ')})`)
      .requiredOption('--score <1-5>', 'score (1-5)')
      .option('--note <text>', 'optional note')
      .option('--session-id <sid>', 'session id')
      .option('--project <path>', 'project root')
  ).action((requestId: string, opts: { item: string; score: string; note?: string; sessionId?: string; project?: string; json?: boolean }) => {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const sessionId = opts.sessionId ?? getCurrentSessionId(projectRoot) ?? 'unknown-sid';
    const score = Number.parseInt(opts.score, 10);
    if (Number.isNaN(score) || score < 1 || score > 5) {
      printResult(io, fail('qa.business-score', 'INVALID_SCORE', `--score must be 1-5 (got "${opts.score}")`, { projectRoot }, []), opts.json ?? false);
      process.exitCode = 1;
      return;
    }
    let review = readQaReview(projectRoot, sessionId, requestId);
    if (review === null) {
      review = buildEmptyQaReview(requestId, sessionId);
    }
    const validIds = QA_BUSINESS_ITEMS.map((i) => i.id);
    if (!validIds.includes(opts.item)) {
      printResult(io, fail('qa.business-score', 'UNKNOWN_ITEM', `unknown item "${opts.item}" (valid: ${validIds.join(', ')})`, { projectRoot }, []), opts.json ?? false);
      process.exitCode = 1;
      return;
    }
    const next = scoreQaItem(review, opts.item, score, opts.note);
    writeQaReview(projectRoot, next);
    printResult(io, ok('qa.business-score', {
      sessionId,
      requestId,
      item: opts.item,
      score,
      derivedDecision: deriveQaDecision(next)
    }, [], [
      deriveQaDecision(next) === 'accepted'
        ? 'All items now average >= 3. Run `peaks qa business-accept` to confirm.'
        : 'Score recorded. Continue scoring other items.'
    ]), opts.json ?? false);
  });

  // 3. business-accept
  addJsonOption(
    program
      .command('qa-business-accept <request-id>')
      .description('Mark the QA business review as accepted (derived decision must be "accepted").')
      .option('--session-id <sid>', 'session id')
      .option('--project <path>', 'project root')
  ).action((requestId: string, opts: { sessionId?: string; project?: string; json?: boolean }) => {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const sessionId = opts.sessionId ?? getCurrentSessionId(projectRoot) ?? 'unknown-sid';
    const review = readQaReview(projectRoot, sessionId, requestId);
    if (review === null) {
      printResult(io, fail('qa.business-accept', 'NO_REVIEW', `no review found for request "${requestId}"`, { projectRoot }, []), opts.json ?? false);
      process.exitCode = 1;
      return;
    }
    const derived = deriveQaDecision(review);
    if (derived !== 'accepted') {
      printResult(io, fail('qa.business-accept', 'CANNOT_ACCEPT', `derived decision is "${derived}" — cannot accept`, { projectRoot, review }, []), opts.json ?? false);
      process.exitCode = 1;
      return;
    }
    const next = acceptQaReview(review);
    writeQaReview(projectRoot, next);
    printResult(io, ok('qa.business-accept', { sessionId, requestId, decision: 'accepted', updatedAt: next.updatedAt }, [], [
      'QA business layer accepted. Proceed to final review.'
    ]), opts.json ?? false);
  });

  // 4. business-reject
  addJsonOption(
    program
      .command('qa-business-reject <request-id>')
      .description('Mark the QA business review as rejected with a reason. Back to RD repair-loop.')
      .requiredOption('--reason <text>', 'rejection reason (required)')
      .option('--session-id <sid>', 'session id')
      .option('--project <path>', 'project root')
  ).action((requestId: string, opts: { reason: string; sessionId?: string; project?: string; json?: boolean }) => {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const sessionId = opts.sessionId ?? getCurrentSessionId(projectRoot) ?? 'unknown-sid';
    const review = readQaReview(projectRoot, sessionId, requestId);
    if (review === null) {
      printResult(io, fail('qa.business-reject', 'NO_REVIEW', `no review found for request "${requestId}"`, { projectRoot }, []), opts.json ?? false);
      process.exitCode = 1;
      return;
    }
    const next = rejectQaReview(review, opts.reason);
    writeQaReview(projectRoot, next);
    printResult(io, ok('qa.business-reject', { sessionId, requestId, decision: 'rejected', reason: opts.reason, updatedAt: next.updatedAt }, [], [
      'QA business layer rejected. Hand back to RD repair-loop.'
    ]), opts.json ?? false);
  });
}
