/**
 * 24h mode state machine — state types + DecisionKey enum.
 *
 * Rid-020a (state-only slice). The proposal defines six states that
 * capture the lifecycle of a 24h code run; the DecisionKey enum is the
 * enumeration of B1/B2 decision keys whose retry counter lives in
 * `AttemptsMap`. Persistence and trigger evaluation live in sibling
 * files; this module is pure data so the persistence tests can
 * round-trip without pulling in IO and the decider tests can be
 * exercised on an in-memory map.
 */

export const STATES = [
  'IDLE',
  'BRAINSTORM',
  'USER_CONFIRM',
  '24H_ACTIVE',
  'WAITING_USER',
  'HANDOFF'
] as const;

export type State = (typeof STATES)[number];

/**
 * Reasons recorded in the persisted `attempts` map. Mirrors the
 * 7 B3 trigger rows in the v2 proposal §1 (B3 trigger table) plus
 * generic B1/B2 retry keys (per-key independence in AC-T3).
 */
export const DECISION_KEYS = [
  'prd_direction_change',
  'blocker_3_consecutive_slices',
  'registry_affecting_failure',
  'destructive_irreversible_op',
  'any_B1_B2_failure_3x_non_converging',
  'runtime_or_shared_version_mismatch',
  'sub-agent_stale_5min_x3'
] as const;

export type DecisionKey = (typeof DECISION_KEYS)[number];

/**
 * B3 trigger threshold: per decision key, the 3rd consecutive fire
 * escalates. Lower thresholds are not configurable here — proposal
 * pins the constant so QA v3 can verify.
 */
export const B3_THRESHOLD = 3;

/**
 * The persisted shape for `.peaks/_runtime/<sessionId>/24h-state.json`.
 * `enteredAt` is the ISO timestamp of the most recent state
 * transition; `enteredFrom` is the previous state (or `null` for the
 * IDLE bootstrap). `attempts` is keyed by `DecisionKey` and
 * monotonically incremented by `fireB3`.
 */
export interface State24hSnapshot {
  state: State;
  enteredAt: string;
  enteredFrom: State | null;
  activeSlices: string[];
  monotonicGuards: number;
  autoCompactCount: number;
  checkpoints: number;
  lastCheckpointAt: string | null;
  attempts: Record<DecisionKey, number>;
  exitCondition: string | null;
}

export function isState(value: string): value is State {
  return (STATES as readonly string[]).includes(value);
}

export function isDecisionKey(value: string): value is DecisionKey {
  return (DECISION_KEYS as readonly string[]).includes(value);
}

export function emptyAttempts(): Record<DecisionKey, number> {
  const out = {} as Record<DecisionKey, number>;
  for (const key of DECISION_KEYS) out[key] = 0;
  return out;
}
