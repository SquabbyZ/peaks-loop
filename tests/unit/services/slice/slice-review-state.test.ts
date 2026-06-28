/**
 * v2.15.0 follow-up — G1 tests: slice review state.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acceptReview,
  buildEmptySliceReview,
  DEFAULT_REVIEW_ITEMS,
  deriveDecision,
  getReviewPath,
  readSliceReview,
  rejectReview,
  renderChecklist,
  scoreItem,
  writeSliceReview,
  type SliceReview
} from '../../../../src/services/slice/slice-review-state.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'peaks-slice-review-test-'));
});

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

describe('buildEmptySliceReview', () => {
  it('builds a pending review with 4 default items', () => {
    const r = buildEmptySliceReview('slice-1', 'sid-1', new Date('2026-06-28T10:00:00Z'));
    expect(r.sliceId).toBe('slice-1');
    expect(r.sessionId).toBe('sid-1');
    expect(r.decision).toBe('pending');
    expect(r.items).toHaveLength(4);
    expect(r.items.every((it) => it.score === null)).toBe(true);
  });
});

describe('DEFAULT_REVIEW_ITEMS', () => {
  it('contains the 4 standard 12-Gaps business items', () => {
    const ids = DEFAULT_REVIEW_ITEMS.map((it) => it.id);
    expect(ids).toEqual(['business-match', 'boundary-cases', 'ui-assembly', 'mergeable']);
  });
});

describe('readSliceReview / writeSliceReview (round-trip)', () => {
  it('round-trips a review through disk', () => {
    const r = buildEmptySliceReview('slice-A', 'sid-A', new Date('2026-06-28T10:00:00Z'));
    writeSliceReview(tmpDir, r);
    expect(existsSync(getReviewPath(tmpDir, 'sid-A', 'slice-A'))).toBe(true);
    const onDisk = JSON.parse(readFileSync(getReviewPath(tmpDir, 'sid-A', 'slice-A'), 'utf8'));
    expect(onDisk.sliceId).toBe('slice-A');
    const reloaded = readSliceReview(tmpDir, 'sid-A', 'slice-A');
    expect(reloaded).toEqual(r);
  });
  it('returns null when the review does not exist', () => {
    expect(readSliceReview(tmpDir, 'sid', 'nope')).toBeNull();
  });
});

describe('scoreItem (immutability)', () => {
  it('returns a new review with the item scored', () => {
    const r = buildEmptySliceReview('s', 'sid', new Date('2026-06-28T10:00:00Z'));
    const next = scoreItem(r, 'business-match', 4, undefined, new Date('2026-06-28T11:00:00Z'));
    expect(next.items[0]?.score).toBe(4);
    expect(next.items[1]?.score).toBeNull();
    expect(r.items[0]?.score).toBeNull(); // immutability
  });
  it('returns the same review when the item id is unknown', () => {
    const r = buildEmptySliceReview('s', 'sid', new Date());
    const next = scoreItem(r, 'nope', 5);
    expect(next).toBe(r);
  });
});

describe('deriveDecision (12 Gaps threshold)', () => {
  it('returns pending when no items scored', () => {
    const r = buildEmptySliceReview('s', 'sid');
    expect(deriveDecision(r)).toBe('pending');
  });
  it('returns rejected when any item is 1 (P0 fail)', () => {
    let r = buildEmptySliceReview('s', 'sid');
    r = scoreItem(r, 'business-match', 5);
    r = scoreItem(r, 'boundary-cases', 5);
    r = scoreItem(r, 'ui-assembly', 1);  // P0 fail
    r = scoreItem(r, 'mergeable', 5);
    expect(deriveDecision(r)).toBe('rejected');
  });
  it('returns rejected when any item is 2', () => {
    let r = buildEmptySliceReview('s', 'sid');
    r = scoreItem(r, 'business-match', 5);
    r = scoreItem(r, 'boundary-cases', 2);  // 2 also rejects
    r = scoreItem(r, 'ui-assembly', 5);
    r = scoreItem(r, 'mergeable', 5);
    expect(deriveDecision(r)).toBe('rejected');
  });
  it('returns accepted when all items >= 3 and avg >= 3', () => {
    let r = buildEmptySliceReview('s', 'sid');
    r = scoreItem(r, 'business-match', 4);
    r = scoreItem(r, 'boundary-cases', 3);
    r = scoreItem(r, 'ui-assembly', 4);
    r = scoreItem(r, 'mergeable', 5);
    expect(deriveDecision(r)).toBe('accepted');
  });
  it('returns rejected when avg < 3', () => {
    let r = buildEmptySliceReview('s', 'sid');
    r = scoreItem(r, 'business-match', 3);
    r = scoreItem(r, 'boundary-cases', 3);
    r = scoreItem(r, 'ui-assembly', 3);
    r = scoreItem(r, 'mergeable', 3);
    expect(deriveDecision(r)).toBe('accepted'); // avg 3.0 = OK
    // Push one down to 2 → avg 2.75 → reject.
    r = scoreItem(r, 'mergeable', 2);
    expect(deriveDecision(r)).toBe('rejected');
  });
});

describe('acceptReview / rejectReview', () => {
  it('accept sets decision to accepted and updates the timestamp', () => {
    const r = buildEmptySliceReview('s', 'sid', new Date('2026-06-28T10:00:00Z'));
    const next = acceptReview(r, new Date('2026-06-28T11:00:00Z'));
    expect(next.decision).toBe('accepted');
    expect(next.updatedAt).toBe('2026-06-28T11:00:00.000Z');
  });
  it('reject sets decision to rejected and stores the reason', () => {
    const r = buildEmptySliceReview('s', 'sid', new Date('2026-06-28T10:00:00Z'));
    const next = rejectReview(r, 'auth flow broken', new Date('2026-06-28T11:00:00Z'));
    expect(next.decision).toBe('rejected');
    expect(next.rejectionReason).toBe('auth flow broken');
  });
});

describe('renderChecklist', () => {
  it('renders pending items as "[ ]" with current score', () => {
    const r = buildEmptySliceReview('s', 'sid');
    const items = renderChecklist(r);
    expect(items[0]?.prompt).toContain('[ ]');
    expect(items[0]?.prompt).toContain('not scored');
  });
  it('renders scored items with the score visible', () => {
    let r = buildEmptySliceReview('s', 'sid');
    r = scoreItem(r, 'business-match', 5);
    const items = renderChecklist(r);
    expect(items[0]?.prompt).toContain('5/5');
  });
});
