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
  | {
      applied: false;
      mode: string;
      reason: 'mode-not-auto-settable' | 'no-in-flight-lease' | 'stamp-failed';
    };

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

/**
 * Turn a presence-mode stamp result into envelope-level `warnings` /
 * `nextActions`, so a `{ applied: false }` is SEEN rather than merely
 * present in `data`.
 *
 * Slice H3 (rid=h3-24h-threshold-not-wired): `no-in-flight-lease` is
 * the common case in practice — entering `24H_ACTIVE` before any skill
 * workflow has a lease — and it used to be reported only inside
 * `data.presenceMode`, where nothing read it. The user then believed
 * the 24h thresholds were in force while the profile still resolved to
 * `standard`.
 *
 * `nextActions` address the LLM driver (it runs the CLI on the user's
 * behalf); they never ask the user to type a verb.
 */
export function presenceModeAdvisory(result: AutoEngagePresenceResult): {
  readonly warnings: readonly string[];
  readonly nextActions: readonly string[];
} {
  if (result.applied) return { warnings: [], nextActions: [] };
  if (result.reason === 'no-in-flight-lease') {
    return {
      warnings: [
        'The `24h` presence mode was NOT recorded: no in-flight presence lease to stamp (`no-in-flight-lease`). Auto-compact thresholds are still derived from the 24h state machine, so the 24h (partial) lines apply; the mode gate and statusline will NOT see `24h`.'
      ],
      nextActions: [
        'Do NOT report that the 24h thresholds are inactive — they are active via the 24h state machine. If the mode gate / statusline also need to see `24h`, start the skill workflow first and then re-run `peaks session 24h-mode transition --state 24H_ACTIVE` yourself. Do not ask the user to run it.'
      ]
    };
  }
  return {
    warnings: [
      `The \`24h\` presence mode was NOT recorded (\`${result.reason}\`). Auto-compact thresholds are still derived from the 24h state machine, so the 24h (partial) lines apply; the mode gate and statusline will NOT see \`24h\`.`
    ],
    nextActions: []
  };
}
