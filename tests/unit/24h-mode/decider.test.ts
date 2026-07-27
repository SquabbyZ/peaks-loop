/**
 * rid-020a — 24h mode decider: B3 trigger evaluation + per-key independence.
 *
 * AC-A3: decider.ts fires B3 on 7 reasons + attempts counter increments per key.
 * AC-A6 (test half): B1xB3 combination cases (AC-T1 attempts=1 continue,
 *                     AC-T2 attempts=3 throw B3Escalation, AC-T3 per-key
 *                     independence).
 *
 * The decider is the single mutating primitive for retry bookkeeping
 * (proposal §1 fireB3). AC-T1/T2/T3 are the three load-bearing cases
 * QA v2 closed in the S4 lens.
 */

import { describe, expect, it } from 'vitest';
import { B3_THRESHOLD } from '../../../src/services/24h-mode/state.js';
import {
  AUTO_ENGAGE_TRIGGERS,
  B3_TRIGGER_REASONS,
  B3Escalation,
  HANDOFF_EXIT_CONDITIONS,
  checkTriggers,
  fireB3,
  freshAttempts,
  isAutoEngageTrigger,
  isB3Reason,
  isHandoffExitCondition,
  isHandoffState,
  isValidReason,
  type AttemptsMap
} from '../../../src/services/24h-mode/decider.js';

describe('rid-020a: 24h-mode/decider', () => {
  it('B3_TRIGGER_REASONS is the 7-row table from proposal §1', () => {
    expect(B3_TRIGGER_REASONS).toEqual([
      'prd_direction_change',
      'blocker_3_consecutive_slices',
      'registry_affecting_failure',
      'destructive_irreversible_op',
      'any_B1_B2_failure_3x_non_converging',
      'runtime_or_shared_version_mismatch',
      'sub-agent_stale_5min_x3'
    ]);
  });

  it('AUTO_ENGAGE_TRIGGERS lists T3 + T4 (T1/T2/T5 flow through BRAINSTORM)', () => {
    expect(AUTO_ENGAGE_TRIGGERS).toEqual(['T3', 'T4']);
    expect(isAutoEngageTrigger('T1')).toBe(false);
    expect(isAutoEngageTrigger('T3')).toBe(true);
    expect(isAutoEngageTrigger('T4')).toBe(true);
    expect(isAutoEngageTrigger('T5')).toBe(false);
  });

  it('isB3Reason + isValidReason accept all 7 keys (AC-A3)', () => {
    for (const r of B3_TRIGGER_REASONS) {
      expect(isB3Reason(r)).toBe(true);
      expect(isValidReason(r)).toBe(true);
    }
    expect(isB3Reason('not_a_reason')).toBe(false);
  });

  it('HANDOFF_EXIT_CONDITIONS is the 3-row table from proposal §1', () => {
    expect(HANDOFF_EXIT_CONDITIONS).toEqual([
      'user_abort',
      'all_triggers_resolved',
      'b3_unresolvable'
    ]);
    for (const c of HANDOFF_EXIT_CONDITIONS) {
      expect(isHandoffExitCondition(c)).toBe(true);
    }
    expect(isHandoffExitCondition('random')).toBe(false);
  });

  it('isHandoffState is true only for HANDOFF', () => {
    expect(isHandoffState('HANDOFF')).toBe(true);
    expect(isHandoffState('IDLE')).toBe(false);
    expect(isHandoffState('24H_ACTIVE')).toBe(false);
  });

  it('freshAttempts returns a fresh map with all 7 keys = 0', () => {
    const a = freshAttempts();
    expect(Object.keys(a).sort()).toEqual([...B3_TRIGGER_REASONS].sort());
    for (const r of B3_TRIGGER_REASONS) expect(a[r]).toBe(0);
  });

  // ---- B1xB3 combination cases (AC-T1 / AC-T2 / AC-T3) ----

  it('AC-T1: first fireB3 returns continue and increments to 1 (no B3)', () => {
    const attempts: AttemptsMap = freshAttempts();
    const result = fireB3('prd_direction_change', attempts);
    expect(result.kind).toBe('continue');
    expect(result.attempts).toBe(1);
    expect(result.reason).toBe('prd_direction_change');
    expect(attempts['prd_direction_change']).toBe(1);
  });

  it('AC-T1b: second fireB3 returns continue and increments to 2 (still no B3)', () => {
    const attempts: AttemptsMap = freshAttempts();
    fireB3('prd_direction_change', attempts);
    const result = fireB3('prd_direction_change', attempts);
    expect(result.kind).toBe('continue');
    expect(result.attempts).toBe(2);
  });

  it('AC-T2: 3rd fireB3 on the same key returns escalate (B3 escalation)', () => {
    const attempts: AttemptsMap = freshAttempts();
    fireB3('runtime_or_shared_version_mismatch', attempts);
    fireB3('runtime_or_shared_version_mismatch', attempts);
    expect(attempts['runtime_or_shared_version_mismatch']).toBe(2);
    const result = fireB3('runtime_or_shared_version_mismatch', attempts);
    expect(result.kind).toBe('escalate');
    expect(result.reason).toBe('runtime_or_shared_version_mismatch');
    expect(result.attempts).toBe(3);
  });

  it('AC-T2b: B3Escalation class is still constructable for callers that prefer throw style', () => {
    const e = new B3Escalation('prd_direction_change', 3);
    expect(e).toBeInstanceOf(Error);
    expect(e.reason).toBe('prd_direction_change');
    expect(e.attempts).toBe(3);
    expect(e.name).toBe('B3Escalation');
  });

  it('AC-T3: per-key independence — B1 and B2 counters are independent', () => {
    const attempts: AttemptsMap = freshAttempts();
    // Use two of the 7 trigger reasons as proxies for B1/B2 retry keys
    // (the decider treats every key independently regardless of prefix).
    fireB3('blocker_3_consecutive_slices', attempts);
    fireB3('sub-agent_stale_5min_x3', attempts);
    expect(attempts['blocker_3_consecutive_slices']).toBe(1);
    expect(attempts['sub-agent_stale_5min_x3']).toBe(1);
    // Other keys remain 0.
    for (const r of B3_TRIGGER_REASONS) {
      if (r !== 'blocker_3_consecutive_slices' && r !== 'sub-agent_stale_5min_x3') {
        expect(attempts[r]).toBe(0);
      }
    }
  });

  it('fireB3 on different keys does not cross-contaminate after a B3 escalation', () => {
    const attempts: AttemptsMap = freshAttempts();
    // Escalate key A.
    fireB3('registry_affecting_failure', attempts);
    fireB3('registry_affecting_failure', attempts);
    const escalated = fireB3('registry_affecting_failure', attempts);
    expect(escalated.kind).toBe('escalate');
    // Key B is still at 0.
    expect(attempts['destructive_irreversible_op']).toBe(0);
    // Key B can still fire normally.
    const n = fireB3('destructive_irreversible_op', attempts);
    expect(n.kind).toBe('continue');
    expect(n.attempts).toBe(1);
    expect(attempts['destructive_irreversible_op']).toBe(1);
  });

  // ---- checkTriggers (5 trigger conditions T1-T5) ----

  it('checkTriggers fires T1 on keyword match', () => {
    const r = checkTriggers({
      userMessage: '请帮我通宵跑完 rid-020a',
      sliceListSize: 5,
      estimatedWallHours: 0.5,
      monotonicGuards: 0,
      remainingSlices: 5,
      sessionGapHours: 0,
      activeSlicesAcrossServices: 1
    });
    expect(r.triggered).toBe(true);
    expect(r.trigger).toBe('T1');
  });

  it('checkTriggers fires T2 on slice-list ≥ 30', () => {
    const r = checkTriggers({
      userMessage: '',
      sliceListSize: 35,
      estimatedWallHours: 1,
      monotonicGuards: 0,
      remainingSlices: 35,
      sessionGapHours: 0,
      activeSlicesAcrossServices: 1
    });
    expect(r.triggered).toBe(true);
    expect(r.trigger).toBe('T2');
  });

  it('checkTriggers fires T3 on monotonic-guards ≥ 3 with remaining ≥ 10', () => {
    const r = checkTriggers({
      userMessage: '',
      sliceListSize: 12,
      estimatedWallHours: 1,
      monotonicGuards: 4,
      remainingSlices: 12,
      sessionGapHours: 0,
      activeSlicesAcrossServices: 1
    });
    expect(r.triggered).toBe(true);
    expect(r.trigger).toBe('T3');
  });

  it('checkTriggers fires T4 on session-gap ≥ 4h with remaining > 0', () => {
    const r = checkTriggers({
      userMessage: '',
      sliceListSize: 5,
      estimatedWallHours: 1,
      monotonicGuards: 0,
      remainingSlices: 5,
      sessionGapHours: 8,
      activeSlicesAcrossServices: 1
    });
    expect(r.triggered).toBe(true);
    expect(r.trigger).toBe('T4');
  });

  it('checkTriggers fires T5 on active slices across services ≥ 3', () => {
    const r = checkTriggers({
      userMessage: '',
      sliceListSize: 4,
      estimatedWallHours: 1,
      monotonicGuards: 0,
      remainingSlices: 4,
      sessionGapHours: 0,
      activeSlicesAcrossServices: 4
    });
    expect(r.triggered).toBe(true);
    expect(r.trigger).toBe('T5');
  });

  it('checkTriggers returns no trigger when none of T1-T5 match', () => {
    const r = checkTriggers({
      userMessage: 'fix typo',
      sliceListSize: 2,
      estimatedWallHours: 0.2,
      monotonicGuards: 0,
      remainingSlices: 2,
      sessionGapHours: 0,
      activeSlicesAcrossServices: 1
    });
    expect(r.triggered).toBe(false);
    expect(r.trigger).toBeNull();
  });
});
