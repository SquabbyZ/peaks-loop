/**
 * Public barrel for 24h-mode service module.
 *
 * Rid-020a (state-only slice). Exports the 6-state enum, the
 * DecisionKey enum, the persistence API, and the B3 decider API
 * so that the `peaks session 24h-mode` CLI (and future rid-020b
 * `peaks code run --24h`) can consume them without reaching into
 * the internal file layout.
 */

export {
  B3_THRESHOLD,
  DECISION_KEYS,
  STATES,
  emptyAttempts,
  isDecisionKey,
  isState,
  type DecisionKey,
  type State,
  type State24hSnapshot
} from './state.js';

export {
  STATE_STORE_CONSTANTS,
  emptySnapshot,
  read24hState,
  write24hState
} from './store.js';

export {
  AUTO_ENGAGE_TRIGGERS,
  B3_TRIGGER_REASONS,
  B3Escalation,
  HANDOFF_EXIT_CONDITIONS,
  T1_KEYWORDS,
  T2_MIN_SLICES,
  T2_MIN_WALL_HOURS,
  T3_MIN_MONOTONIC_GUARDS,
  T3_MIN_REMAINING_SLICES,
  T4_SESSION_GAP_HOURS,
  T5_MIN_ACTIVE_SLICES,
  checkTriggers,
  fireB3,
  freshAttempts,
  isAutoEngageTrigger,
  isB3Reason,
  isHandoffExitCondition,
  isHandoffState,
  isValidReason,
  type AttemptsMap,
  type AutoEngageTrigger,
  type B3Reason,
  type FireB3Result,
  type HandoffExitCondition,
  type TriggerCheck
} from './decider.js';
