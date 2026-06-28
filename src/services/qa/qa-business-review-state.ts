/**
 * v2.15.0 follow-up — G5: QA business-perspective review state.
 *
 * Similar in shape to G1 (slice review) but lives on the QA side and
 * uses the 6-item business checklist from the 12 Gaps positioning
 * memory. Technical verification (coverage / P99 / security scan) is
 * AI auto-decided in `peaks-rd`'s fan-out; QA only records what the
 * user (business / product reviewer) sees.
 *
 * Persistence: `.peaks/_runtime/<sid>/qa-business-reviews/<rid>.json`.
 *
 *   6 items: business-flow / req-coverage / boundary-cases / ui-assembly /
 *            exception-tone / mergeable
 *   decision: pending | accepted | rejected
 *   threshold: avg >= 3 AND no item <= 2 (same as G1)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type QaReviewDecision = 'pending' | 'accepted' | 'rejected';

export interface QaReviewItem {
  readonly id: string;
  readonly question: string;
  readonly score: number | null;
  readonly note?: string;
}

export interface QaBusinessReview {
  readonly requestId: string;
  readonly sessionId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly decision: QaReviewDecision;
  readonly items: readonly QaReviewItem[];
  readonly rejectionReason?: string;
}

/** 6-item business checklist (12 Gaps QA perspective). */
export const QA_BUSINESS_ITEMS: readonly { id: string; question: string }[] = [
  { id: 'business-flow', question: '这个功能"用起来"对吗?(业务流程顺不顺,操作路径是否反人类,跟现有系统交互有没有断层)' },
  { id: 'req-coverage', question: '老板提的需求都覆盖了吗?(大需求点 vs 小需求点,显式需求 vs 隐式需求)' },
  { id: 'boundary-cases', question: '边界 case 跟业务预期一致吗?(异常输入 / 错误提示用户语言 / 空加载失败状态)' },
  { id: 'ui-assembly', question: '页面模式 / 关键交互 / 信息密度 跟产品预期一致吗?(装配验收,非视觉设计)' },
  { id: 'exception-tone', question: '异常态 / 边界态视觉跟产品语调一致吗?(空状态有引导 / 加载态不闪烁 / 失败态有重试入口)' },
  { id: 'mergeable', question: '能合入下个小版本吗?(业务风险 / 用户体验风险 / 集成断点)' }
];

export function buildEmptyQaReview(requestId: string, sessionId: string, now: Date = new Date()): QaBusinessReview {
  return {
    requestId,
    sessionId,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    decision: 'pending',
    items: QA_BUSINESS_ITEMS.map((it) => ({ id: it.id, question: it.question, score: null }))
  };
}

export function getQaReviewDir(projectRoot: string, sessionId: string): string {
  return resolve(projectRoot, '.peaks', '_runtime', sessionId, 'qa-business-reviews');
}

export function getQaReviewPath(projectRoot: string, sessionId: string, requestId: string): string {
  return join(getQaReviewDir(projectRoot, sessionId), `${requestId}.json`);
}

export function readQaReview(projectRoot: string, sessionId: string, requestId: string): QaBusinessReview | null {
  const path = getQaReviewPath(projectRoot, sessionId, requestId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as QaBusinessReview;
  } catch (err) {
    console.warn(`readQaReview: failed to read or parse ${path}: ${(err as Error).message}`);
    return null;
  }
}

export function writeQaReview(projectRoot: string, review: QaBusinessReview): void {
  const path = getQaReviewPath(projectRoot, review.sessionId, review.requestId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(review, null, 2), 'utf8');
}

export function scoreQaItem(review: QaBusinessReview, itemId: string, score: number, note?: string, now: Date = new Date()): QaBusinessReview {
  let found = false;
  const items = review.items.map((it) => {
    if (it.id !== itemId) return it;
    found = true;
    return { id: it.id, question: it.question, score, ...(note !== undefined ? { note } : {}) };
  });
  if (!found) return review;
  return { ...review, items, updatedAt: now.toISOString() };
}

export function averageQaScore(review: QaBusinessReview): number | null {
  const scored = review.items.filter((it) => it.score !== null) as Array<{ id: string; question: string; score: number; note?: string }>;
  if (scored.length === 0) return null;
  return scored.reduce((sum, it) => sum + it.score, 0) / scored.length;
}

export function deriveQaDecision(review: QaBusinessReview): QaReviewDecision {
  if (review.items.some((it) => it.score === 1)) return 'rejected';
  const avg = averageQaScore(review);
  if (avg === null) return 'pending';
  if (avg < 3) return 'rejected';
  if (review.items.some((it) => it.score !== null && it.score <= 2)) return 'rejected';
  return 'accepted';
}

export function acceptQaReview(review: QaBusinessReview, now: Date = new Date()): QaBusinessReview {
  return { ...review, decision: 'accepted', updatedAt: now.toISOString() };
}

export function rejectQaReview(review: QaBusinessReview, reason: string, now: Date = new Date()): QaBusinessReview {
  return { ...review, decision: 'rejected', rejectionReason: reason, updatedAt: now.toISOString() };
}
