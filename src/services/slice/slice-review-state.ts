/**
 * v2.15.0 follow-up — G1: slice business review state.
 *
 * The 12 Gaps positioning memory: each slice completion triggers a
 * business review by the user (not a technical review). The user
 * evaluates 4-5 business / product items; technical metrics (coverage,
 * P99, security scan) are AI auto-decided in `peaks-rd`'s fan-out.
 *
 * State persistence: `.peaks/_runtime/<sid>/slice-reviews/<slice-id>.json`.
 *
 *   reviewScore: 1-5 per item; overallOk when avg >= 3 AND no P0 fail
 *   decision: pending | accepted | rejected
 *   rejectionReason: only when decision = rejected
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type SliceReviewDecision = 'pending' | 'accepted' | 'rejected';

export interface SliceReviewItem {
  /** Item identifier (e.g. "business-match", "boundary-cases", "ui-assembly", "mergeable"). */
  readonly id: string;
  /** Human-readable question / check. */
  readonly question: string;
  /** User's score 1-5, or null when not yet reviewed. */
  readonly score: number | null;
  /** Optional user note (especially on rejection). */
  readonly note?: string;
}

export interface SliceReview {
  readonly sliceId: string;
  /** Session id this review belongs to. */
  readonly sessionId: string;
  /** ISO when the review was first opened (or the slice completed). */
  readonly createdAt: string;
  /** ISO when the user last updated (accepted/rejected). */
  readonly updatedAt: string;
  /** Current decision. */
  readonly decision: SliceReviewDecision;
  /** The 4-5 review items. */
  readonly items: readonly SliceReviewItem[];
  /** Optional reason when decision = rejected. */
  readonly rejectionReason?: string;
}

/** The 5 default review items per slice (the 12 Gaps memory checklist). */
export const DEFAULT_REVIEW_ITEMS: readonly { id: string; question: string }[] = [
  { id: 'business-match', question: '这个 slice 做完,业务流程对吗?(跟产品最初给的需求匹配)' },
  { id: 'boundary-cases', question: '边界 case 跟业务预期一致吗?(异常输入/错误提示/空/加载/失败状态)' },
  { id: 'ui-assembly', question: 'UI 装配跟产品预期一致吗?(页面模式/关键交互/信息密度,非视觉设计)' },
  { id: 'mergeable', question: '能合入下个业务版本吗?(业务风险/集成断点)' }
];

export function buildEmptySliceReview(sliceId: string, sessionId: string, now: Date = new Date()): SliceReview {
  return {
    sliceId,
    sessionId,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    decision: 'pending',
    items: DEFAULT_REVIEW_ITEMS.map((it) => ({ id: it.id, question: it.question, score: null }))
  };
}

export function getReviewDir(projectRoot: string, sessionId: string): string {
  return resolve(projectRoot, '.peaks', '_runtime', sessionId, 'slice-reviews');
}

export function getReviewPath(projectRoot: string, sessionId: string, sliceId: string): string {
  return join(getReviewDir(projectRoot, sessionId), `${sliceId}.json`);
}

export function readSliceReview(projectRoot: string, sessionId: string, sliceId: string): SliceReview | null {
  const path = getReviewPath(projectRoot, sessionId, sliceId);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8');
    return JSON.parse(raw) as SliceReview;
  } catch (err) {
    console.warn(`readSliceReview: failed to read or parse ${path}: ${(err as Error).message}`);
    return null;
  }
}

export function writeSliceReview(projectRoot: string, review: SliceReview): void {
  const path = getReviewPath(projectRoot, review.sessionId, review.sliceId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(review, null, 2), 'utf8');
}

/** Update a single item's score. Returns the new state. */
export function scoreItem(review: SliceReview, itemId: string, score: number, note?: string, now: Date = new Date()): SliceReview {
  let found = false;
  const items = review.items.map((it) => {
    if (it.id !== itemId) return it;
    found = true;
    return { id: it.id, question: it.question, score, ...(note !== undefined ? { note } : {}) };
  });
  if (!found) return review;
  return { ...review, items, updatedAt: now.toISOString() };
}

/** Compute the average score across all scored items. */
export function averageScore(review: SliceReview): number | null {
  const scored = review.items.filter((it) => it.score !== null) as Array<{ id: string; question: string; score: number; note?: string }>;
  if (scored.length === 0) return null;
  return scored.reduce((sum, it) => sum + it.score, 0) / scored.length;
}

/** Decide accept/reject based on the 12 Gaps threshold:
 *   - avg score >= 3 AND no item scored <= 2 → accepted
 *   - any item scored 1 (P0 fail) or avg < 3 → rejected
 */
export function deriveDecision(review: SliceReview): SliceReviewDecision {
  if (review.items.some((it) => it.score === 1)) return 'rejected';
  const avg = averageScore(review);
  if (avg === null) return 'pending';
  if (avg < 3) return 'rejected';
  // Any item <= 2 also rejects.
  if (review.items.some((it) => it.score !== null && it.score <= 2)) return 'rejected';
  return 'accepted';
}

/** Apply the derived decision to a review (used by `peaks slice accept`). */
export function acceptReview(review: SliceReview, now: Date = new Date()): SliceReview {
  return { ...review, decision: 'accepted', updatedAt: now.toISOString() };
}

export function rejectReview(review: SliceReview, reason: string, now: Date = new Date()): SliceReview {
  return { ...review, decision: 'rejected', rejectionReason: reason, updatedAt: now.toISOString() };
}

/** Render the review as a user-facing checklist (for `peaks slice review`). */
export interface ReviewChecklistItem {
  readonly id: string;
  readonly question: string;
  readonly currentScore: number | null;
  readonly prompt: string;
}

export function renderChecklist(review: SliceReview): readonly ReviewChecklistItem[] {
  return review.items.map((it) => ({
    id: it.id,
    question: it.question,
    currentScore: it.score,
    prompt: `  [ ] ${it.question} (current: ${it.score === null ? 'not scored' : it.score + '/5'})`
  }));
}
