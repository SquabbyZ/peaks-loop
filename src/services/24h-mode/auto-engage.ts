/**
 * Slice 2026-09-09-mode-consolidation (Slice B): auto-engage may set the
 * 24h MODE — and ONLY the 24h mode.
 *
 * `24h` is the single mode that may be set without an explicit user pick
 * (the T1–T5 triggers, and `peaks code run --24h`). Every other mode
 * still requires the Step-1 hard-pause AskUserQuestion
 * (`mode-gate.shouldPauseAtGate` keeps `step-1-mode-select` in
 * `HARD_PAUSE_STEPS`).
 *
 * Before this slice the auto-engage paths wrote only
 * `.peaks/_runtime/<sid>/24h-state.json`; the presence lease kept
 * whatever mode it had (or none), so `24h` was invisible to the mode
 * gate and `strict` + `24H_ACTIVE` still paused every gate. This module
 * is the single place that closes that gap, and the single guard that
 * refuses to stamp any other mode.
 */

import { stampPresenceLeaseMode } from '../skills/presence-lease-service.js';

export const AUTO_ENGAGE_PRESENCE_MODE = '24h' as const;

export type AutoEngagePresenceResult =
  | { applied: true; mode: typeof AUTO_ENGAGE_PRESENCE_MODE; updated: number }
  | { applied: false; mode: string; reason: 'mode-not-auto-settable' | 'no-in-flight-lease' | 'stamp-failed' };

/**
 * Stamp the 24h mode onto every in-flight presence lease of the bound
 * session. Fail-soft: never throws — a missing lease / unreadable store
 * degrades to `{ applied: false }` so the auto-engage caller can still
 * report the 24h-state transition.
 */
export function applyAutoEngagePresenceMode(input: {
  projectRoot: string;
  sessionId: string;
  /** Defaults to `24h`; any other value is refused. */
  mode?: string;
}): AutoEngagePresenceResult {
  const mode = input.mode ?? AUTO_ENGAGE_PRESENCE_MODE;
  if (mode !== AUTO_ENGAGE_PRESENCE_MODE) {
    return { applied: false, mode, reason: 'mode-not-auto-settable' };
  }
  let updated: number;
  try {
    updated = stampPresenceLeaseMode({
      projectRoot: input.projectRoot,
      sessionId: input.sessionId,
      mode: AUTO_ENGAGE_PRESENCE_MODE
    }).updated;
  } catch {
    return { applied: false, mode, reason: 'stamp-failed' };
  }
  if (updated === 0) {
    return { applied: false, mode, reason: 'no-in-flight-lease' };
  }
  return { applied: true, mode: AUTO_ENGAGE_PRESENCE_MODE, updated };
}
