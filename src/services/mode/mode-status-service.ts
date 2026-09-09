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
import type { State24hSnapshot } from '../24h-mode/state.js';
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
 * Resolve the auto-compact profile from the MODE, not from the 24h
 * state machine. `24h` mode → `partial` (earlier thresholds for
 * long-run sessions); every other mode → `standard`.
 *
 * Slice 2026-09-09-mode-consolidation: this replaced the previous
 * `24h-state.state === '24H_ACTIVE'` mapping. The state machine is the
 * long-run *phase*; the mode is the autonomy level the user (or the
 * T3/T4 auto-engage) selected. Keying off the mode means a `24h`
 * session keeps the partial profile even while it is in
 * `WAITING_USER`, which is the correct long-run behaviour.
 */
export function resolveAutoCompactProfile(projectRoot: string): AutoCompactMode {
  return resolvePresenceMode(projectRoot).mode === '24h' ? 'partial' : 'standard';
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

  return {
    mode: presence.mode,
    skill: presence.skill,
    modeSource: presence.source,
    is24h,
    h24State,
    jobMode,
    autoCompactProfile: is24h ? 'partial' : 'standard',
    autoCompactThresholds: AUTO_COMPACT_THRESHOLDS[is24h ? 'partial' : 'standard']
  };
}
