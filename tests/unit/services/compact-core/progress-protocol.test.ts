/**
 * Phase 2 Task 2.3 — canonical compact progress semantics tests.
 *
 * Pins the progress-protocol contract (design §8):
 *   - `COMPACT_STAGE_WEIGHTS` is the canonical weight table:
 *       preparing=10, checkpointing=15, summarizing=25, replacing=20,
 *       verifying=20, resuming=10 — sums to 100.
 *   - `CompactProgressTracker.accept(events)` accumulates events in
 *     arrival order and produces a `CompactProgressSnapshot`.
 *   - terminal lock: once `completed` or `failed` is accepted, all
 *     subsequent events are ignored; the snapshot reports `terminal`
 *     non-null and stays on the last accepted values.
 *   - attempt-id regression: an event whose `attemptId` differs from the
 *     currently-bound attempt is dropped and sets `rejected: true`.
 *   - stage regression: a `stage` event whose index is below the current
 *     accepted stage index is dropped and sets `rejected: true`.
 *   - progress regression: a `progress` event with `completed <
 *     lastCompleted` is dropped and sets `rejected: true`; non-decreasing
 *     values are accepted.
 *   - 100% invariant: `totalPercent === 100` ONLY after a `completed`
 *     event for the current path is accepted. Progress alone — even at
 *     `completed: total` within the final `resuming` stage — must not
 *     drive `totalPercent` to 100.
 *   - `verifyResumeCompletion(events)` returns `ok: true` only when the
 *     stream contains a `completed` event whose receipt has all required
 *     identity + continuity fields non-empty and a valid `path` value.
 *
 * Tests are non-tautological: each branch exercises a distinct invariant.
 */
import { describe, expect, it } from 'vitest';
import type {
  CompactCompletionReceipt,
  CompactEvent,
  CompactStage
} from '../../../../src/services/compact-core/index.js';
import {
  COMPACT_STAGE_WEIGHTS,
  CompactProgressTracker,
  verifyResumeCompletion
} from '../../../../src/services/compact-core/progress-protocol.js';

// ── Helpers ────────────────────────────────────────────────────────────────

const ATTEMPT = 'attempt-A';
const PATH_GEN = 0;

function started(overrides: Partial<{ path: 'native' | 'fallback' }> = {}): CompactEvent {
  return {
    type: 'started',
    attemptId: ATTEMPT,
    pathGeneration: PATH_GEN,
    path: overrides.path ?? 'native'
  };
}

function stage(name: CompactStage, attemptId: string = ATTEMPT, pathGeneration: number = PATH_GEN): CompactEvent {
  return {
    type: 'stage',
    attemptId,
    pathGeneration,
    stage: name,
    label: humanLabel(name)
  };
}

function progress(
  completed: number,
  total: number,
  attemptId: string = ATTEMPT,
  pathGeneration: number = PATH_GEN
): CompactEvent {
  return {
    type: 'progress',
    attemptId,
    pathGeneration,
    completed,
    total,
    unit: 'work'
  };
}

function detail(message: string): CompactEvent {
  return {
    type: 'detail',
    attemptId: ATTEMPT,
    pathGeneration: PATH_GEN,
    message
  };
}

function makeReceipt(overrides: Partial<CompactCompletionReceipt> = {}): CompactCompletionReceipt {
  return {
    attemptId: ATTEMPT,
    pathGeneration: PATH_GEN,
    path: 'native',
    sameUi: true,
    before: { ratio: 0.95, source: 'exact', measuredAt: '2026-07-23T00:00:00.000Z' },
    after: { ratio: 0.4, source: 'exact', measuredAt: '2026-07-23T00:00:01.000Z' },
    completionSource: 'host-event',
    continuationToken: 'tok-abc',
    completedAt: '2026-07-23T00:00:02.000Z',
    ...overrides
  };
}

function completed(receipt: Partial<CompactCompletionReceipt> = {}): CompactEvent {
  return {
    type: 'completed',
    attemptId: ATTEMPT,
    pathGeneration: PATH_GEN,
    receipt: makeReceipt(receipt)
  };
}

function failed(code: string = 'COMPACT_TIMEOUT', recoverable: boolean = true): CompactEvent {
  return {
    type: 'failed',
    attemptId: ATTEMPT,
    pathGeneration: PATH_GEN,
    code,
    recoverable
  };
}

function humanLabel(stage: CompactStage): string {
  switch (stage) {
    case 'preparing':
      return 'Preparing';
    case 'checkpointing':
      return 'Checkpointing';
    case 'summarizing':
      return 'Summarizing';
    case 'replacing':
      return 'Replacing';
    case 'verifying':
      return 'Verifying';
    case 'resuming':
      return 'Resuming';
  }
}

/** Build the full canonical stage sequence with progress events. */
function happyPathEvents(receiptOverrides: Partial<CompactCompletionReceipt> = {}): CompactEvent[] {
  return [
    started({ path: 'native' }),
    stage('preparing'),
    progress(1, 1),
    stage('checkpointing'),
    progress(1, 1),
    stage('summarizing'),
    progress(1, 1),
    stage('replacing'),
    progress(1, 1),
    stage('verifying'),
    progress(1, 1),
    stage('resuming'),
    progress(1, 1),
    completed(receiptOverrides)
  ];
}

// ── Weight table contract ───────────────────────────────────────────────────

describe('COMPACT_STAGE_WEIGHTS', () => {
  it('assigns the canonical Phase 2 weights and sums to 100', () => {
    expect(COMPACT_STAGE_WEIGHTS).toEqual({
      preparing: 10,
      checkpointing: 15,
      summarizing: 25,
      replacing: 20,
      verifying: 20,
      resuming: 10
    });
    const total = Object.values(COMPACT_STAGE_WEIGHTS).reduce((sum, w) => sum + w, 0);
    expect(total).toBe(100);
  });

  it('includes a weight for the new `resuming` stage (Phase 2 addition)', () => {
    expect(COMPACT_STAGE_WEIGHTS.resuming).toBe(10);
  });
});

// ── Tracker basics ──────────────────────────────────────────────────────────

describe('CompactProgressTracker', () => {
  it('returns a zero snapshot on an empty stream', () => {
    const t = new CompactProgressTracker();
    const snap = t.accept([]);
    expect(snap.totalPercent).toBe(0);
    expect(snap.completedStages).toEqual([]);
    expect(snap.terminal).toBeNull();
    expect(snap.rejected).toBe(false);
    expect(snap.lastEventAt).toBeNull();
  });

  it('reports totalPercent=100 only after a completed event for the current path', () => {
    const t = new CompactProgressTracker();
    const snap = t.accept(happyPathEvents());
    expect(snap.totalPercent).toBe(100);
    expect(snap.terminal).toBe('completed');
    expect(snap.completedStages).toEqual([
      'preparing',
      'checkpointing',
      'summarizing',
      'replacing',
      'verifying',
      'resuming'
    ]);
    expect(snap.lastEventAt).toBe('2026-07-23T00:00:02.000Z');
    expect(snap.rejected).toBe(false);
  });

  it('does NOT reach 100% when progress reports 100/100 inside the final `resuming` stage', () => {
    const events: CompactEvent[] = [
      stage('preparing'),
      stage('checkpointing'),
      stage('summarizing'),
      stage('replacing'),
      stage('verifying'),
      stage('resuming'),
      // progress events signal 100/100 inside `resuming`
      progress(100, 100)
    ];
    const t = new CompactProgressTracker();
    const snap = t.accept(events);
    expect(snap.totalPercent).toBeLessThan(100);
    expect(snap.terminal).toBeNull();
    expect(snap.completedStages).not.toContain('resuming');
  });

  it('caps in-progress stage contribution so the sum never reaches 100 without a terminal `completed`', () => {
    // Even with progress 100/100 in every stage (no terminal event),
    // totalPercent must stay below 100.
    const events: CompactEvent[] = [
      stage('preparing'),
      progress(100, 100),
      stage('checkpointing'),
      progress(100, 100),
      stage('summarizing'),
      progress(100, 100),
      stage('replacing'),
      progress(100, 100),
      stage('verifying'),
      progress(100, 100),
      stage('resuming'),
      progress(100, 100)
    ];
    const t = new CompactProgressTracker();
    const snap = t.accept(events);
    expect(snap.totalPercent).toBeLessThan(100);
    expect(snap.terminal).toBeNull();
  });

  it('is deterministic: the same input stream yields the same snapshot', () => {
    const events = happyPathEvents();
    const a = new CompactProgressTracker().accept(events);
    const b = new CompactProgressTracker().accept(events);
    expect(a).toEqual(b);
  });
});

// ── Regression rules ────────────────────────────────────────────────────────

describe('CompactProgressTracker regression rules', () => {
  it('drops events whose attemptId differs from the currently-bound attempt and sets rejected=true', () => {
    const events: CompactEvent[] = [
      stage('preparing'), // binds attemptId=ATTEMPT
      stage('checkpointing', 'attempt-B') // different attemptId
    ];
    const t = new CompactProgressTracker();
    const snap = t.accept(events);
    expect(snap.rejected).toBe(true);
    // Bouncing to a different attempt must not advance the stage.
    expect(snap.completedStages).toEqual([]);
    // `preparing` is still in progress (not moved past).
    expect(snap.totalPercent).toBeLessThan(10);
  });

  it('drops stage events whose index is lower than the current accepted stage', () => {
    const events: CompactEvent[] = [
      stage('checkpointing'),
      stage('preparing') // regression: index 5 → 0
    ];
    const t = new CompactProgressTracker();
    const snap = t.accept(events);
    expect(snap.rejected).toBe(true);
    // The tracker stays on `checkpointing` as the current stage.
    expect(snap.completedStages).toEqual([]);
  });

  it('accepts a same-index stage event as a no-op (no regression)', () => {
    const events: CompactEvent[] = [
      stage('preparing'),
      stage('preparing')
    ];
    const t = new CompactProgressTracker();
    const snap = t.accept(events);
    expect(snap.rejected).toBe(false);
    expect(snap.completedStages).toEqual([]);
  });

  it('accepts monotonic progress events and drops those with completed < lastCompleted', () => {
    const events: CompactEvent[] = [
      stage('preparing'),
      progress(3, 10),
      progress(5, 10), // accepted (5 > 3)
      progress(4, 10), // rejected (4 < 5)
      progress(7, 10) // accepted (7 > 5)
    ];
    const t = new CompactProgressTracker();
    const snap = t.accept(events);
    expect(snap.rejected).toBe(true); // sticky after the rejection
    // The progress fraction for `preparing` must reflect the last accepted
    // value (7/10), not the rejected 4/10.
    const expectedPreparingFraction = 7 / 10;
    const expectedTotal = 10 * expectedPreparingFraction;
    expect(snap.totalPercent).toBe(Math.floor(expectedTotal));
  });

  it('keeps the snapshot monotonic across multiple accept() batches', () => {
    const t = new CompactProgressTracker();
    t.accept([stage('preparing')]);
    const a = t.accept([progress(5, 10)]);
    expect(a.totalPercent).toBe(Math.floor(10 * 0.5));
    // Dropping a regression in a later batch does NOT undo earlier progress.
    const b = t.accept([progress(2, 10)]); // rejected (2 < 5)
    expect(b.rejected).toBe(true);
    expect(b.totalPercent).toBe(Math.floor(10 * 0.5));
    const c = t.accept([progress(8, 10)]);
    expect(c.totalPercent).toBe(Math.floor(10 * 0.8));
  });
});

// ── Terminal lock ──────────────────────────────────────────────────────────

describe('CompactProgressTracker terminal lock', () => {
  it('locks after `completed` and ignores subsequent events', () => {
    const t = new CompactProgressTracker();
    const first = t.accept(happyPathEvents());
    expect(first.terminal).toBe('completed');
    expect(first.totalPercent).toBe(100);

    // Any further events are dropped.
    const second = t.accept([stage('preparing'), progress(1, 1)]);
    expect(second.terminal).toBe('completed');
    expect(second.totalPercent).toBe(100);
    expect(second.completedStages).toEqual(first.completedStages);
    expect(second.rejected).toBe(false); // no NEW regression triggered
  });

  it('locks after `failed` and ignores subsequent events', () => {
    const t = new CompactProgressTracker();
    const first = t.accept([
      stage('preparing'),
      stage('checkpointing'),
      failed('COMPACT_TIMEOUT', true)
    ]);
    expect(first.terminal).toBe('failed');
    expect(first.totalPercent).toBeLessThan(100);
    // Both `preparing` and `checkpointing` are moved past: `preparing`
    // because the `checkpointing` event arrived, and `checkpointing`
    // because the `failed` event terminated the attempt while
    // `checkpointing` was the current stage.
    expect(first.completedStages).toEqual(['preparing', 'checkpointing']);

    const second = t.accept([stage('summarizing'), progress(1, 1)]);
    expect(second.terminal).toBe('failed');
    expect(second.totalPercent).toBe(first.totalPercent);
    expect(second.completedStages).toEqual(first.completedStages);
  });

  it('exactly one terminal event: a `failed` after `completed` is ignored', () => {
    const t = new CompactProgressTracker();
    const snap = t.accept([
      ...happyPathEvents(),
      failed('SHOULD_NOT_OVERTURN', false)
    ]);
    expect(snap.terminal).toBe('completed');
    expect(snap.totalPercent).toBe(100);
    expect(snap.lastEventAt).toBe('2026-07-23T00:00:02.000Z');
  });

  it('exactly one terminal event: a `completed` after `failed` is ignored', () => {
    const t = new CompactProgressTracker();
    const snap = t.accept([
      stage('preparing'),
      stage('checkpointing'),
      failed('COMPACT_TIMEOUT', true),
      completed() // ignored
    ]);
    expect(snap.terminal).toBe('failed');
    expect(snap.totalPercent).toBeLessThan(100);
    expect(snap.lastEventAt).toBeNull();
  });
});

// ── Indeterminate stage support ─────────────────────────────────────────────

describe('CompactProgressTracker indeterminate stages', () => {
  it('reports 0 percent for a stage that was entered but produced no progress events', () => {
    const t = new CompactProgressTracker();
    const snap = t.accept([stage('preparing')]);
    expect(snap.totalPercent).toBe(0);
    expect(snap.completedStages).toEqual([]);
  });

  it('honors `started` as identity-only (does not move the stage pointer)', () => {
    const t = new CompactProgressTracker();
    const snap = t.accept([started()]);
    expect(snap.totalPercent).toBe(0);
    expect(snap.completedStages).toEqual([]);
    expect(snap.terminal).toBeNull();
  });

  it('marks the previous stage as moved-past when the next stage event arrives', () => {
    const t = new CompactProgressTracker();
    const snap = t.accept([
      stage('preparing'),
      stage('checkpointing'),
      stage('summarizing')
    ]);
    expect(snap.completedStages).toEqual(['preparing', 'checkpointing']);
    // `summarizing` is current with no progress → 0 in-progress contribution.
    // Preparing (10) + checkpointing (15) = 25
    expect(snap.totalPercent).toBe(25);
  });

  it('uses in-progress progress fraction for the current stage when partial work is reported', () => {
    const t = new CompactProgressTracker();
    const snap = t.accept([
      stage('preparing'),
      stage('checkpointing'),
      stage('summarizing'),
      progress(1, 2)
    ]);
    // preparing (10*1) + checkpointing (15*1) + summarizing (25*0.5) = 37.5 → floor 37
    expect(snap.totalPercent).toBe(37);
    expect(snap.completedStages).toEqual(['preparing', 'checkpointing']);
  });

  it('allows `detail` events to pass through without affecting the snapshot', () => {
    const t = new CompactProgressTracker();
    const snap = t.accept([stage('preparing'), detail('warming up'), progress(1, 2)]);
    // detail is a no-op: totalPercent = 10 * 0.5 = 5
    expect(snap.totalPercent).toBe(5);
    expect(snap.rejected).toBe(false);
  });
});

// ── `lastEventAt` semantics ────────────────────────────────────────────────

describe('CompactProgressTracker.lastEventAt', () => {
  it('is null until a `completed` event arrives', () => {
    const t = new CompactProgressTracker();
    expect(t.accept([stage('preparing')]).lastEventAt).toBeNull();
    expect(t.accept([progress(1, 1)]).lastEventAt).toBeNull();
    expect(t.accept([failed('X', true)]).lastEventAt).toBeNull();
  });

  it('is set to `receipt.completedAt` after a `completed` event', () => {
    const t = new CompactProgressTracker();
    const snap = t.accept(happyPathEvents({ completedAt: '2026-07-23T01:02:03.000Z' }));
    expect(snap.lastEventAt).toBe('2026-07-23T01:02:03.000Z');
  });
});

// ── `verifyResumeCompletion` ───────────────────────────────────────────────

describe('verifyResumeCompletion', () => {
  /** Narrow `ResumeCompletionResult` so we can read `.reason` in tests. */
  function failureReason(res: ReturnType<typeof verifyResumeCompletion>): string {
    if (res.ok) {
      throw new Error('expected verifyResumeCompletion to return ok=false');
    }
    return res.reason;
  }

  it('returns ok=true for a well-formed completed event', () => {
    const res = verifyResumeCompletion(happyPathEvents());
    expect(res).toEqual({ ok: true });
  });

  it('returns ok=false with a reason when no completed event is in the stream', () => {
    const res = verifyResumeCompletion([stage('preparing'), stage('checkpointing')]);
    expect(res.ok).toBe(false);
    expect(failureReason(res)).toMatch(/completed/);
  });

  it('returns ok=false when the receipt attemptId is empty', () => {
    const res = verifyResumeCompletion([completed({ attemptId: '' })]);
    expect(res.ok).toBe(false);
    expect(failureReason(res)).toMatch(/attemptId/);
  });

  it('returns ok=false when the receipt path is not native or fallback', () => {
    const res = verifyResumeCompletion([completed({ path: 'weird' as 'native' })]);
    expect(res.ok).toBe(false);
    expect(failureReason(res)).toMatch(/path/);
  });

  it('returns ok=false when the continuationToken is empty', () => {
    const res = verifyResumeCompletion([completed({ continuationToken: '' })]);
    expect(res.ok).toBe(false);
    expect(failureReason(res)).toMatch(/continuationToken|continuation/);
  });

  it('returns ok=false when the receipt does not confirm sameUi', () => {
    const res = verifyResumeCompletion([completed({ sameUi: false as true })]);
    expect(res.ok).toBe(false);
    expect(failureReason(res)).toMatch(/same.?ui|sameUi/i);
  });

  it('returns ok=false when pathGeneration is negative', () => {
    const res = verifyResumeCompletion([completed({ pathGeneration: -1 })]);
    expect(res.ok).toBe(false);
    expect(failureReason(res)).toMatch(/pathGeneration|generation/i);
  });

  it('accepts both `native` and `fallback` paths as valid resume paths', () => {
    expect(verifyResumeCompletion([started({ path: 'fallback' }), completed({ path: 'fallback' })])).toEqual({
      ok: true
    });
    expect(verifyResumeCompletion([started({ path: 'native' }), completed({ path: 'native' })])).toEqual({
      ok: true
    });
  });

  it('requires the receipt path to match the started event path (mismatched path is rejected)', () => {
    // started says fallback but receipt says native → mismatch
    const res = verifyResumeCompletion([started({ path: 'fallback' }), completed({ path: 'native' })]);
    expect(res.ok).toBe(false);
    expect(failureReason(res)).toMatch(/path/);
  });

  it('skips earlier completed events and validates the LAST completed event in the stream', () => {
    const events: CompactEvent[] = [
      completed({ attemptId: '' }), // invalid first
      started({ path: 'native' }),
      completed() // valid second
    ];
    const res = verifyResumeCompletion(events);
    expect(res.ok).toBe(true);
  });
});