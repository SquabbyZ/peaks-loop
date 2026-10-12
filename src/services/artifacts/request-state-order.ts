// src/services/artifacts/request-state-order.ts
//
// The request state machine's ORDER rule, in one place (S-14, session
// `2026-10-12-session-74bd69`).
//
// `ALLOWED_STATES_PER_ROLE` is a SEQUENCE, but `transitionRequestArtifact`
// tested only membership. Measured: with `rd → implemented` and
// `rd → qa-handoff` both refused, `rd → handed-off` still passed — a slice
// could report itself delivered past every intermediate gate. A FORWARD jump is
// refused here.
//
// Deliberately allowed: any move to or from `blocked` (a side state, not a
// step); the current state; and any move BACKWARD — the QA return-to-rd repair
// re-enters `rd: spec-locked` from `qa-handoff` (micro-cycle.md §"How Code
// routes QA findings back to RD"), so this is a skip test, not a rising-rank
// test. `--allow-incomplete` bypasses it, like every other transition gate —
// the flag opens FOUR gates now (order, prerequisites, lint, file size), so the
// refusal's own remedy line reads narrower than the flag actually is.
//
// FAIL-CLOSED. An unreadable current state is REFUSED, not allowed: allowing it
// would make a deleted `- state:` line an off-switch for this whole gate.
//
// Split out of `request-artifact-state-helpers.ts` (254 raw lines at the split)
// so that file stays under its 300-line cap while this rule has room to be
// stated in full.

import {
  ALLOWED_STATES_PER_ROLE,
  type RequestArtifactState
} from './request-artifact-state-helpers.js';
import type { RequestArtifactRole } from './artifact-templates.js';

/** The role's states in declared order, minus `blocked` (which has no rank). */
function orderedStatesForRole(role: RequestArtifactRole): ReadonlyArray<RequestArtifactState> {
  return ALLOWED_STATES_PER_ROLE[role].filter((state) => state !== 'blocked');
}

export type StateOrderBreach = {
  /** `jump` — the move skips past an intermediate state. `unreadable` — the
   *  current state could not be read, so the move cannot be shown to be legal. */
  kind: 'jump' | 'unreadable';
  /** The states this move skips over. Empty for `unreadable`. */
  skipped: ReadonlyArray<RequestArtifactState>;
  /** The one legal next state from a READABLE current one, else `null`. */
  next: RequestArtifactState | null;
};

/**
 * `null` when the move is allowed, or the breach when it is not.
 *
 * FAIL-CLOSED on an unreadable current state. A carrier with no `- state:` line
 * reads as the literal `'unknown'` (the `readArtifactState(...) ?? 'unknown'`
 * fallback in the transition service), and this gate runs before every other
 * one. Reading "I could not read it" as "no jump" would therefore hand the gate
 * an off-switch that is one deleted line — re-opening the `rd → handed-off` jump
 * this module exists to stop — so an unreadable state is refused, not allowed.
 */
export function stateOrderViolation(
  role: RequestArtifactRole,
  from: string,
  to: RequestArtifactState
): StateOrderBreach | null {
  if (from === 'blocked' || to === 'blocked') return null;
  const order = orderedStatesForRole(role);
  const toIndex = order.indexOf(to);
  if (toIndex < 0) return null;
  const fromIndex = order.indexOf(from as RequestArtifactState);
  if (fromIndex < 0) return { kind: 'unreadable', skipped: [], next: null };
  if (toIndex <= fromIndex + 1) return null;
  return {
    kind: 'jump',
    skipped: order.slice(fromIndex + 1, toIndex),
    next: order[fromIndex + 1] ?? null
  };
}

/** The breach kinds get their own codes: a refusal that cannot be named is a
 *  refusal a consumer cannot act on, and "jumped" is not "could not be read". */
export const STATE_ORDER_JUMP_CODE = 'STATE_ORDER_JUMP';
export const STATE_ORDER_UNREADABLE_CODE = 'STATE_ORDER_UNREADABLE';

export class StateOrderViolationError extends Error {
  readonly code: string;
  readonly role: RequestArtifactRole;
  readonly from: string;
  readonly to: RequestArtifactState;
  readonly skipped: ReadonlyArray<RequestArtifactState>;
  readonly kind: StateOrderBreach['kind'];
  constructor(
    role: RequestArtifactRole,
    from: string,
    to: RequestArtifactState,
    breach: StateOrderBreach
  ) {
    super(
      `Cannot transition ${role} from '${from}' to '${to}': ` +
        (breach.kind === 'unreadable'
          ? "the artifact's current state could not be read (no '- state:' line, " +
            "or a state this role's machine does not define). Failing closed — a move " +
            'that cannot be shown to be legal is refused, not allowed. '
          : `that skips ${breach.skipped.map((state) => `'${state}'`).join(', ')}. ` +
            (breach.next === null
              ? ''
              : `Move one state at a time — the next legal state is '${breach.next}'. `)) +
        'Walk the states in order, or bypass with --allow-incomplete --reason "<justification>".'
    );
    this.name = 'StateOrderViolationError';
    this.code = breach.kind === 'unreadable' ? STATE_ORDER_UNREADABLE_CODE : STATE_ORDER_JUMP_CODE;
    this.role = role;
    this.from = from;
    this.to = to;
    this.kind = breach.kind;
    this.skipped = breach.skipped;
  }
}

/** Throws when `to` skips an intermediate state or the current state is
 *  unreadable. `bypass` is the caller's `--allow-incomplete` escape hatch. */
export function assertLegalStateStep(
  role: RequestArtifactRole,
  from: string,
  to: RequestArtifactState,
  bypass: boolean
): void {
  if (bypass) return;
  const breach = stateOrderViolation(role, from, to);
  if (breach !== null) {
    throw new StateOrderViolationError(role, from, to, breach);
  }
}
