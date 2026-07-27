/**
 * rid-020a — 24h mode state enum + DecisionKey enum + transition guards.
 *
 * AC-A1: state.ts compiles + State enum 6 values exported + DecisionKey enum.
 * Verifies the 6-state enum (IDLE / BRAINSTORM / USER_CONFIRM / 24H_ACTIVE /
 * WAITING_USER / HANDOFF) and the 7 DecisionKey values, plus the type
 * guards and `emptyAttempts` shape.
 */

import { describe, expect, it } from 'vitest';
import {
  B3_THRESHOLD,
  DECISION_KEYS,
  STATES,
  emptyAttempts,
  isDecisionKey,
  isState
} from '../../../src/services/24h-mode/state.js';

describe('rid-020a: 24h-mode/state', () => {
  it('STATES exposes exactly the 6 proposal values (AC-A1)', () => {
    expect(STATES).toEqual([
      'IDLE',
      'BRAINSTORM',
      'USER_CONFIRM',
      '24H_ACTIVE',
      'WAITING_USER',
      'HANDOFF'
    ]);
  });

  it('DECISION_KEYS exposes exactly the 7 B3 trigger values (AC-A1)', () => {
    expect(DECISION_KEYS).toEqual([
      'prd_direction_change',
      'blocker_3_consecutive_slices',
      'registry_affecting_failure',
      'destructive_irreversible_op',
      'any_B1_B2_failure_3x_non_converging',
      'runtime_or_shared_version_mismatch',
      'sub-agent_stale_5min_x3'
    ]);
  });

  it('B3_THRESHOLD is 3 (proposal pins the constant)', () => {
    expect(B3_THRESHOLD).toBe(3);
  });

  it('isState accepts all 6 states and rejects foreign values', () => {
    for (const s of STATES) expect(isState(s)).toBe(true);
    expect(isState('idle')).toBe(false); // case-sensitive
    expect(isState('BRAINSTORMING')).toBe(false);
    expect(isState('')).toBe(false);
    expect(isState('24H')).toBe(false);
  });

  it('isDecisionKey accepts all 7 keys and rejects foreign values', () => {
    for (const k of DECISION_KEYS) expect(isDecisionKey(k)).toBe(true);
    expect(isDecisionKey('B1.retry.sub-agent-X')).toBe(false);
    expect(isDecisionKey('unknown')).toBe(false);
    expect(isDecisionKey('')).toBe(false);
  });

  it('emptyAttempts returns a fresh object with all 7 keys = 0', () => {
    const a = emptyAttempts();
    expect(Object.keys(a).sort()).toEqual([...DECISION_KEYS].sort());
    for (const k of DECISION_KEYS) expect(a[k]).toBe(0);
  });

  it('emptyAttempts returns a fresh object per call (no shared mutable state)', () => {
    const a = emptyAttempts();
    const b = emptyAttempts();
    a['prd_direction_change'] = 7;
    expect(b['prd_direction_change']).toBe(0);
  });
});
