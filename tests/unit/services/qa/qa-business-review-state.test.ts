/**
 * v2.15.0 follow-up — G5 tests: QA business review state.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acceptQaReview,
  buildEmptyQaReview,
  averageQaScore,
  deriveQaDecision,
  getQaReviewPath,
  QA_BUSINESS_ITEMS,
  readQaReview,
  rejectQaReview,
  scoreQaItem,
  writeQaReview
} from '../../../../src/services/qa/qa-business-review-state.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'peaks-qa-business-test-'));
});

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

describe('buildEmptyQaReview', () => {
  it('builds a pending review with 6 default items', () => {
    const r = buildEmptyQaReview('rid-1', 'sid-1', new Date('2026-06-28T10:00:00Z'));
    expect(r.requestId).toBe('rid-1');
    expect(r.sessionId).toBe('sid-1');
    expect(r.decision).toBe('pending');
    expect(r.items).toHaveLength(6);
    expect(r.items.every((it) => it.score === null)).toBe(true);
  });
});

describe('QA_BUSINESS_ITEMS', () => {
  it('contains the 6 standard 12-Gaps business items', () => {
    const ids = QA_BUSINESS_ITEMS.map((it) => it.id);
    expect(ids).toEqual(['business-flow', 'req-coverage', 'boundary-cases', 'ui-assembly', 'exception-tone', 'mergeable']);
  });
});

describe('readQaReview / writeQaReview (round-trip)', () => {
  it('round-trips a review through disk', () => {
    const r = buildEmptyQaReview('rid-A', 'sid-A', new Date('2026-06-28T10:00:00Z'));
    writeQaReview(tmpDir, r);
    expect(existsSync(getQaReviewPath(tmpDir, 'sid-A', 'rid-A'))).toBe(true);
    const onDisk = JSON.parse(readFileSync(getQaReviewPath(tmpDir, 'sid-A', 'rid-A'), 'utf8'));
    expect(onDisk.requestId).toBe('rid-A');
    const reloaded = readQaReview(tmpDir, 'sid-A', 'rid-A');
    expect(reloaded).toEqual(r);
  });
  it('returns null when the review does not exist', () => {
    expect(readQaReview(tmpDir, 'sid', 'nope')).toBeNull();
  });
});

describe('scoreQaItem (immutability)', () => {
  it('returns a new review with the item scored', () => {
    const r = buildEmptyQaReview('r', 'sid');
    const next = scoreQaItem(r, 'business-flow', 4, undefined, new Date('2026-06-28T11:00:00Z'));
    expect(next.items[0]?.score).toBe(4);
    expect(next.items[1]?.score).toBeNull();
    expect(r.items[0]?.score).toBeNull();
  });
});

describe('averageQaScore + deriveQaDecision (12 Gaps threshold)', () => {
  it('average returns null when no items scored', () => {
    const r = buildEmptyQaReview('r', 'sid');
    expect(averageQaScore(r)).toBeNull();
  });
  it('average is the mean of scored items', () => {
    let r = buildEmptyQaReview('r', 'sid');
    r = scoreQaItem(r, 'business-flow', 5);
    r = scoreQaItem(r, 'req-coverage', 3);
    expect(averageQaScore(r)).toBe(4);
  });
  it('returns pending when no items scored', () => {
    const r = buildEmptyQaReview('r', 'sid');
    expect(deriveQaDecision(r)).toBe('pending');
  });
  it('returns rejected when any item is 1 (P0 fail)', () => {
    let r = buildEmptyQaReview('r', 'sid');
    r = scoreQaItem(r, 'business-flow', 5);
    r = scoreQaItem(r, 'req-coverage', 5);
    r = scoreQaItem(r, 'boundary-cases', 5);
    r = scoreQaItem(r, 'ui-assembly', 1);  // P0 fail
    r = scoreQaItem(r, 'exception-tone', 5);
    r = scoreQaItem(r, 'mergeable', 5);
    expect(deriveQaDecision(r)).toBe('rejected');
  });
  it('returns accepted when all items >= 3 and avg >= 3', () => {
    let r = buildEmptyQaReview('r', 'sid');
    r = scoreQaItem(r, 'business-flow', 4);
    r = scoreQaItem(r, 'req-coverage', 3);
    r = scoreQaItem(r, 'boundary-cases', 4);
    r = scoreQaItem(r, 'ui-assembly', 5);
    r = scoreQaItem(r, 'exception-tone', 4);
    r = scoreQaItem(r, 'mergeable', 5);
    expect(deriveQaDecision(r)).toBe('accepted');
  });
});

describe('acceptQaReview / rejectQaReview', () => {
  it('accept sets decision to accepted', () => {
    const r = buildEmptyQaReview('r', 'sid', new Date('2026-06-28T10:00:00Z'));
    const next = acceptQaReview(r, new Date('2026-06-28T11:00:00Z'));
    expect(next.decision).toBe('accepted');
    expect(next.updatedAt).toBe('2026-06-28T11:00:00.000Z');
  });
  it('reject sets decision to rejected and stores the reason', () => {
    const r = buildEmptyQaReview('r', 'sid', new Date('2026-06-28T10:00:00Z'));
    const next = rejectQaReview(r, 'business flow broken', new Date('2026-06-28T11:00:00Z'));
    expect(next.decision).toBe('rejected');
    expect(next.rejectionReason).toBe('business flow broken');
  });
});
