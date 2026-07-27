/**
 * 24h mode B3 trigger evaluation + attempts counter.
 *
 * Rid-020a (state-only slice). `fireB3` is the single mutating
 * primitive: it increments the per-key counter and escalates with a
 * `B3Escalation` when the count reaches `B3_THRESHOLD` (3). The
 * counter is **per-key** — AC-T3 mandates B1 and B2 retries do not
 * share a global counter. The T3/T4 auto-24H_ACTIVE path is encoded
 * in `isAutoEngageTrigger` (BRAINSTORM is bypassed for these
 * triggers so an offline-resumed session does not deadlock in
 * WAITING_USER — proposal §1 T3/T4 exception).
 */

import {
  B3_THRESHOLD,
  isDecisionKey,
  type DecisionKey,
  type State
} from './state.js';

export type AttemptsMap = Record<DecisionKey, number>;

export const B3_TRIGGER_REASONS = [
  'prd_direction_change',
  'blocker_3_consecutive_slices',
  'registry_affecting_failure',
  'destructive_irreversible_op',
  'any_B1_B2_failure_3x_non_converging',
  'runtime_or_shared_version_mismatch',
  'sub-agent_stale_5min_x3'
] as const;

export type B3Reason = (typeof B3_TRIGGER_REASONS)[number];

export class B3Escalation extends Error {
  readonly reason: B3Reason;
  readonly attempts: number;
  constructor(reason: B3Reason, attempts: number) {
    super(`B3 escalation: reason=${reason}, attempts=${attempts}`);
    this.name = 'B3Escalation';
    this.reason = reason;
    this.attempts = attempts;
  }
}

/**
 * Result envelope for `fireB3`. We return a discriminated union
 * (instead of throwing) so callers can branch on `kind` without
 * try/catch ceremony. The B3Escalation class is still exported for
 * backward compatibility with callers that prefer the throw style.
 */
export type FireB3Result =
  | { kind: 'continue'; reason: B3Reason; attempts: number }
  | { kind: 'escalate'; reason: B3Reason; attempts: number };

export function isB3Reason(value: string): value is B3Reason {
  return (B3_TRIGGER_REASONS as readonly string[]).includes(value);
}

export function isValidReason(value: string): value is DecisionKey {
  return isDecisionKey(value);
}

export function freshAttempts(): AttemptsMap {
  const out = {} as AttemptsMap;
  for (const key of B3_TRIGGER_REASONS) out[key] = 0;
  return out;
}

/**
 * Per AC-T1 (attempts=1 continue, no B3) and AC-T2 (attempts=3
 * escalate), the 3rd call escalates. The threshold is intentionally
 * NOT configurable — the proposal pins the constant so QA v3 can
 * assert it. Returns a FireB3Result instead of throwing so test
 * code can read the `attempts` field via plain property access
 * (Error-subclass property access through vitest 4.1.10 matchers
 * is unreliable; the discriminated union sidesteps that).
 */
export function fireB3(reason: B3Reason, attempts: AttemptsMap): FireB3Result {
  const cur = attempts[reason] ?? 0;
  const next = cur + 1;
  attempts[reason] = next;
  if (next >= B3_THRESHOLD) {
    return { kind: 'escalate', reason, attempts: next };
  }
  return { kind: 'continue', reason, attempts: next };
}

/**
 * T3 (runaway recovery) and T4 (offline resume) auto-engage
 * `24H_ACTIVE` without forcing `USER_CONFIRM` — the deferred
 * AskUserQuestion fires at the first 10min checkpoint instead, so
 * a T4 session does not deadlock in `WAITING_USER` while the
 * user is offline (proposal §1 T3/T4 exception).
 */
export const AUTO_ENGAGE_TRIGGERS = ['T3', 'T4'] as const;
export type AutoEngageTrigger = (typeof AUTO_ENGAGE_TRIGGERS)[number];

export function isAutoEngageTrigger(t: string): t is AutoEngageTrigger {
  return (AUTO_ENGAGE_TRIGGERS as readonly string[]).includes(t);
}

/**
 * Five trigger conditions (T1-T5) from proposal §1 + companion
 * trigger-and-decision-autonomy sediment. T1/T2/T5 flow through
 * BRAINSTORM; T3/T4 auto-engage and skip the gate.
 */
export interface TriggerCheck {
  triggered: boolean;
  trigger: 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | null;
  reason: string;
}

export const T1_KEYWORDS = ['24h', '通宵跑', '通宵', '夜跑', '夜机', '不计成本', '不停机'];
export const T2_MIN_SLICES = 30;
export const T2_MIN_WALL_HOURS = 6;
export const T3_MIN_MONOTONIC_GUARDS = 3;
export const T3_MIN_REMAINING_SLICES = 10;
export const T4_SESSION_GAP_HOURS = 4;
export const T5_MIN_ACTIVE_SLICES = 3;

export function checkTriggers(input: {
  userMessage: string;
  sliceListSize: number;
  estimatedWallHours: number;
  monotonicGuards: number;
  remainingSlices: number;
  sessionGapHours: number;
  activeSlicesAcrossServices: number;
}): TriggerCheck {
  if (T1_KEYWORDS.some((kw) => input.userMessage.includes(kw))) {
    return { triggered: true, trigger: 'T1', reason: `T1 keyword match in user message` };
  }
  if (input.sliceListSize >= T2_MIN_SLICES || input.estimatedWallHours >= T2_MIN_WALL_HOURS) {
    return {
      triggered: true,
      trigger: 'T2',
      reason: `T2 scale: sliceList=${input.sliceListSize} OR wallHours=${input.estimatedWallHours}`
    };
  }
  if (
    input.monotonicGuards >= T3_MIN_MONOTONIC_GUARDS &&
    input.remainingSlices >= T3_MIN_REMAINING_SLICES
  ) {
    return {
      triggered: true,
      trigger: 'T3',
      reason: `T3 runaway recovery: monotonicGuards=${input.monotonicGuards} remaining=${input.remainingSlices}`
    };
  }
  if (input.sessionGapHours >= T4_SESSION_GAP_HOURS && input.remainingSlices > 0) {
    return {
      triggered: true,
      trigger: 'T4',
      reason: `T4 offline resume: gapHours=${input.sessionGapHours} remaining=${input.remainingSlices}`
    };
  }
  if (input.activeSlicesAcrossServices >= T5_MIN_ACTIVE_SLICES) {
    return {
      triggered: true,
      trigger: 'T5',
      reason: `T5 multi-business: activeAcrossServices=${input.activeSlicesAcrossServices}`
    };
  }
  return { triggered: false, trigger: null, reason: 'no trigger' };
}

/**
 * HANDOFF is reachable via three exit conditions per proposal §1:
 *   - user abort
 *   - all-trigger-resolved
 *   - B3 unresolvable (B3Escalation that the user dismisses)
 */
export const HANDOFF_EXIT_CONDITIONS = ['user_abort', 'all_triggers_resolved', 'b3_unresolvable'] as const;
export type HandoffExitCondition = (typeof HANDOFF_EXIT_CONDITIONS)[number];

export function isHandoffExitCondition(s: string): s is HandoffExitCondition {
  return (HANDOFF_EXIT_CONDITIONS as readonly string[]).includes(s);
}

export function isHandoffState(s: State): boolean {
  return s === 'HANDOFF';
}
