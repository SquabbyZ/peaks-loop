/**
 * Slice 2026-09-09-mode-consolidation (Slice D): one read for the whole
 * stacked mode picture.
 *
 * The autonomy model has two layers that used to be read by nothing in
 * common:
 *
 *   - MODE  — `SkillPresenceMode` on the presence lease: the autonomy
 *     level (`full-auto | assisted | strict | 24h`).
 *   - STATE — `.peaks/_runtime/<sid>/24h-state.json`, the 6-state
 *     machine (`IDLE / BRAINSTORM / USER_CONFIRM / 24H_ACTIVE /
 *     WAITING_USER / HANDOFF`): the long-run PHASE *inside* the `24h`
 *     mode.
 *
 * This module is the single place that reads both, plus the Job-mode
 * decision and the resolved auto-compact profile, so `peaks code mode
 * status` (and any future consumer) does not re-derive the stack.
 *
 * Read-only + fail-soft: every sub-read is wrapped so a missing or
 * malformed artifact degrades to `null` / `false` rather than throwing.
 */

import { resolveActiveSkillForCaller } from '../audit/enforcers/active-skill-resolver.js';
import { getCurrentSessionId, type SkillPresenceMode } from '../skills/skill-presence-service.js';
// Import the 24h store directly (NOT the `24h-mode/index.js` barrel) —
// the barrel re-exports `decider.ts`, which imports this module, and
// that would form an import cycle.
import { read24hState } from '../24h-mode/store.js';
import type { State, State24hSnapshot } from '../24h-mode/state.js';
import { readJobShapeDecision } from '../code/job-shape-decision.js';
import {
  AUTO_COMPACT_THRESHOLDS,
  type AutoCompactMode
} from '../code/auto-compact-modes.js';

export interface ResolvedPresenceMode {
  readonly mode: SkillPresenceMode | null;
  readonly skill: string | null;
  readonly source: 'canonical' | 'file' | 'env' | 'none';
}

export interface ModeStatus {
  /** Autonomy level from the presence lease; `null` when no lease / no mode recorded. */
  readonly mode: SkillPresenceMode | null;
  /** Active skill name from the same lease read (display aid). */
  readonly skill: string | null;
  /** Where the mode came from. */
  readonly modeSource: 'canonical' | 'file' | 'env' | 'none';
  /** `true` when the resolved mode is `24h`. */
  readonly is24h: boolean;
  /**
   * The 24h internal state machine snapshot. Populated only when
   * `is24h` is true (the phase is meaningless outside the 24h mode);
   * `null` when the mode is not `24h` or the snapshot is unreadable.
   */
  readonly h24State: State24hSnapshot | null;
  /** Job-mode flag from `job-shape.json` (`false` when undecided / unreadable). */
  readonly jobMode: boolean;
  /** Resolved auto-compact profile: `partial` iff the mode is `24h`. */
  readonly autoCompactProfile: AutoCompactMode;
  /** Thresholds backing `autoCompactProfile` (display aid). */
  readonly autoCompactThresholds: {
    readonly autoFire: number;
    readonly preCompact: number;
    readonly redLine: number;
  };
}

/**
 * Read the active presence mode via the canonical lease projection.
 * Never throws.
 */
export function resolvePresenceMode(projectRoot: string): ResolvedPresenceMode {
  try {
    const resolved = resolveActiveSkillForCaller(projectRoot);
    const mode = resolved.mode;
    return {
      mode: mode === null ? null : (mode as SkillPresenceMode),
      skill: resolved.skill,
      source: resolved.source
    };
  } catch {
    return { mode: null, skill: null, source: 'none' };
  }
}

/**
 * The 24h state-machine states in which the long run is ENGAGED.
 *
 * `24H_ACTIVE` is the run itself; `WAITING_USER` is a pause *inside*
 * it (the run is still on — the user just has to answer). `BRAINSTORM`
 * / `USER_CONFIRM` precede the run, `HANDOFF` ends it, `IDLE` means it
 * never started.
 */
const ENGAGED_24H_STATES: ReadonlySet<State> = new Set<State>(['24H_ACTIVE', 'WAITING_USER']);

/**
 * Fail-soft read of the bound session's 24h state machine: `true` when
 * the long run is engaged. Every degradation (no session, missing or
 * malformed snapshot) reads as `false` so a non-24h project is
 * untouched by this signal.
 */
function is24hRunEngaged(projectRoot: string): boolean {
  try {
    const sessionId = getCurrentSessionId(projectRoot);
    if (sessionId === null) return false;
    return ENGAGED_24H_STATES.has(read24hState(projectRoot, sessionId).state);
  } catch {
    return false;
  }
}

/**
 * Resolve the auto-compact profile: `partial` (earlier thresholds for
 * long-run sessions) or `standard`.
 *
 * Two sources answer "is this a 24h long run?", and EITHER is enough:
 *
 *   1. the PRESENCE MODE is `24h` — the autonomy level the user (or
 *      the T3/T4 auto-engage) selected; or
 *   2. the 24h STATE MACHINE is engaged (`24H_ACTIVE` /
 *      `WAITING_USER`) — the durable, session-scoped record.
 *
 * Why both (slice H3, rid=h3-24h-threshold-not-wired): source 1 alone
 * is not reliable. The mode lives on a per-caller, per-workflow
 * presence lease, and `applyAutoEngagePresenceMode` can only stamp
 * leases that are already in flight — entering `24H_ACTIVE` with no
 * in-flight lease fails closed as `{ applied: false, reason:
 * 'no-in-flight-lease' }`. A fresh lease is also written without a
 * mode (`workflow-presence-lifecycle.initWorkflow`), so a successful
 * stamp does not survive the next skill workflow either. The observed
 * consequence was a `24H_ACTIVE` session resolving to `standard` and
 * auto-compacting LATER than a plain session, the opposite of the
 * documented contract.
 *
 * The union is a superset of both the pre-2026-09-09 mapping (state
 * machine) and the 2026-09-09-mode-consolidation mapping (presence
 * mode): keep partial while the mode says `24h` even in
 * `WAITING_USER`, and keep it when only the state machine knows.
 * Nothing that resolved to `partial` before resolves to `standard`
 * now; a project with no 24h run is byte-identical to before.
 */
export function resolveAutoCompactProfile(projectRoot: string): AutoCompactMode {
  if (resolvePresenceMode(projectRoot).mode === '24h') return 'partial';
  return is24hRunEngaged(projectRoot) ? 'partial' : 'standard';
}

/**
 * Assemble the full stacked status. `sessionId` defaults to the
 * canonical binding when omitted.
 */
export function resolveModeStatus(input: {
  projectRoot: string;
  sessionId?: string | null | undefined;
}): ModeStatus {
  const { projectRoot } = input;
  const presence = resolvePresenceMode(projectRoot);
  const is24h = presence.mode === '24h';

  let sessionId: string | null = input.sessionId ?? null;
  if (sessionId === null) {
    try {
      sessionId = getCurrentSessionId(projectRoot);
    } catch {
      sessionId = null;
    }
  }

  let h24State: State24hSnapshot | null = null;
  if (is24h && sessionId !== null) {
    try {
      h24State = read24hState(projectRoot, sessionId);
    } catch {
      h24State = null;
    }
  }

  let jobMode = false;
  if (sessionId !== null) {
    try {
      jobMode = readJobShapeDecision(projectRoot, sessionId).decision.isJob;
    } catch {
      jobMode = false;
    }
  }

  // Delegate rather than re-derive `is24h ? 'partial' : 'standard'`: the
  // profile has a second source (the 24h state machine), and a local
  // copy of the old one-source rule would make `peaks code mode status`
  // advertise a different profile than the one `peaks code
  // auto-compact` actually applies.
  const autoCompactProfile = resolveAutoCompactProfile(projectRoot);

  return {
    mode: presence.mode,
    skill: presence.skill,
    modeSource: presence.source,
    is24h,
    h24State,
    jobMode,
    autoCompactProfile,
    autoCompactThresholds: AUTO_COMPACT_THRESHOLDS[autoCompactProfile]
  };
}
