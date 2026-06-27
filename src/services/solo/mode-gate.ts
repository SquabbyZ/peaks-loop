/**
 * v2.11.0 Group F (Tier 9) — D5: full-auto self-decision gate.
 *
 * Single source of truth for "should this code path auto-proceed or
 * pause for an AskUserQuestion round-trip?" The D5 design (per
 * `.peaks/memory/2026-06-26-v2-11-full-auto-self-decision.md`) requires:
 *
 *   - `full-auto` and `swarm` modes → auto-proceed (recommended = chosen)
 *   - `assisted` and `strict` modes → pause for confirmation
 *   - 3 hard-floor categories ALWAYS ask, regardless of mode:
 *     1. Irreversible external side effects (git push, npm publish, …)
 *     2. Authentication / credential usage
 *     3. Multi-day investment decisions (release tag, breaking change)
 *
 * Karpathy §2: no inline `mode === 'full-auto'` checks scattered across
 * files — this module is the only place. Karpathy §3: this file is
 * surgical to the D5 design; do not extend with unrelated mode helpers.
 *
 * Re-uses `SkillPresenceMode` from `skill-presence-service.ts` so the
 * 4 mode values stay in lockstep with the rest of the runtime.
 */

import type { SkillPresenceMode } from '../skills/skill-presence-service.js';

export type SoloMode = SkillPresenceMode;

export const SOLO_MODES: readonly SoloMode[] = [
  'full-auto',
  'assisted',
  'swarm',
  'strict'
] as const;

export type HardFloorCategory =
  | 'irreversible-external-side-effect'
  | 'authentication-credential'
  | 'multi-day-investment';

export const HARD_FLOOR_CATEGORIES: readonly HardFloorCategory[] = [
  'irreversible-external-side-effect',
  'authentication-credential',
  'multi-day-investment'
] as const;

/**
 * The 14 SKILL.md AskUserQuestion sites mapped in the D5 memory's
 * "Inventory of unconditional confirmation gates" table. Each row
 * is the bare minimum needed to gate it through `shouldPauseAtGate`.
 */
export type GatedStepId =
  | 'step-0.5-openspec-opt-in'
  | 'step-0.6-audit-goal'
  | 'step-0.7-resume-detection'
  | 'step-0.55-1x-upgrade'
  | 'step-1-mode-select'
  | 'step-2.5-session-title'
  | 'phase-2-prd-confirm'
  | 'phase-3-swarm-gate-b'
  | 'phase-6-qa-gate-d'
  | 'phase-10-txt-memory-extract'
  | 'step-n+1-final-review'
  | 'frontend-only-mismatch'
  | 'step-0.75-checkpoint-resume'
  | 'standards-preflight';

export const GATED_STEPS: readonly GatedStepId[] = [
  'step-0.5-openspec-opt-in',
  'step-0.6-audit-goal',
  'step-0.7-resume-detection',
  'step-0.55-1x-upgrade',
  'step-1-mode-select',
  'step-2.5-session-title',
  'phase-2-prd-confirm',
  'phase-3-swarm-gate-b',
  'phase-6-qa-gate-d',
  'phase-10-txt-memory-extract',
  'step-n+1-final-review',
  'frontend-only-mismatch',
  'step-0.75-checkpoint-resume',
  'standards-preflight'
] as const;

/**
 * Slice 2026-06-28-solo-mode-bypass-fix: the kind of gate that
 * produced this decision. The LLM-side caller (peaks-solo body) reads
 * this to distinguish "you paused because the user must choose the
 * mode" (`mode-selection-itself`) from "you paused because the mode
 * you already chose is assisted/strict" (`mode-driven`) from "you
 * paused because a hard-floor category always wins" (`hard-floor`).
 *
 *   - `'mode-selection-itself'` — the gate IS the mode/context
 *     selection step itself (step-1-mode-select,
 *     step-0.5-openspec-opt-in, step-0.7-resume-detection). Even
 *     `full-auto` mode pauses here; otherwise the user's first turn
 *     would auto-lock the mode without their consent.
 *   - `'mode-driven'`           — the gate paused because the active
 *     mode is assisted/strict (the existing default).
 *   - `'hard-floor'`            — the gate paused because a
 *     hard-floor category always wins (irreversible external side
 *     effect / auth / multi-day investment).
 */
export type GateKind = 'mode-selection-itself' | 'mode-driven' | 'hard-floor';

export interface GateDecision {
  readonly shouldPause: boolean;
  /** Human-readable rationale; surfaces in `peaks solo should-pause --json` */
  readonly reason: string;
  /** Hard-floor override applied? Surfaces in audit log when true */
  readonly hardFloorCategory?: HardFloorCategory;
  /** Slice 2026-06-28-solo-mode-bypass-fix: kind of gate that produced
   * this decision. Always present; defaults to `'mode-driven'` for the
   * assisted/strict pause branch. */
  readonly gateKind: GateKind;
}

export function isSoloMode(value: string): value is SoloMode {
  return (SOLO_MODES as readonly string[]).includes(value);
}

export function isHardFloorCategory(value: string): value is HardFloorCategory {
  return (HARD_FLOOR_CATEGORIES as readonly string[]).includes(value);
}

/**
 * `true` when the current mode should auto-proceed (skip the
 * AskUserQuestion round-trip). Mirrors D5.a: "recommended = chosen
 * in full-auto / swarm; always log, never silently skip".
 */
export function shouldAutoProceed(mode: SoloMode): boolean {
  return mode === 'full-auto' || mode === 'swarm';
}

/**
 * Should the LLM emit an AskUserQuestion at `step` given `mode`?
 * Pure function: no IO, no LLM call. The LLM-side caller passes the
 * mode it loaded from skill presence, and the step it is about to
 * execute; this function returns a `GateDecision` with the rationale.
 *
 * The 3 hard-floor categories always win — even full-auto pauses for
 * irreversible external side effects, auth/credential usage, or
 * multi-day investment decisions (D5.b).
 *
 * `hardFloorCategory` is optional on the `GateDecision` so callers can
 * stamp the override into the auto-decisions log without a second
 * switch.
 */

/**
 * Hard-pause steps: these pause regardless of mode. They are the gates
 * whose decision *creates* or *recreates* the mode/state under which
 * later gates run. Auto-proceeding on them would silently fix the mode
 * without user consent (defect #1: new Solo session skipped Step 1
 * AskUserQuestion because `full-auto` mode triggered `shouldAutoProceed`
 * on `step-1-mode-select` itself).
 */
const HARD_PAUSE_STEPS: ReadonlySet<GatedStepId> = new Set<GatedStepId>([
  'step-1-mode-select',
  'step-0.5-openspec-opt-in',
  'step-0.7-resume-detection'
]);

export function shouldPauseAtGate(opts: {
  mode: SoloMode;
  step: GatedStepId;
  hardFloorCategory?: HardFloorCategory | undefined;
}): GateDecision {
  if (opts.hardFloorCategory !== undefined && isHardFloorCategory(opts.hardFloorCategory)) {
    return {
      shouldPause: true,
      reason: `hard-floor category "${opts.hardFloorCategory}" always pauses regardless of mode (D5.b)`,
      hardFloorCategory: opts.hardFloorCategory,
      gateKind: 'hard-floor'
    };
  }

  // Slice 2026-06-28-solo-mode-bypass-fix: hard-pause steps that
  // determine the active mode or session context MUST prompt the
  // user. Otherwise full-auto silently locks in `mode=full-auto` on
  // the first tool call, skipping the AskUserQuestion Step 1 mandates.
  if (HARD_PAUSE_STEPS.has(opts.step)) {
    return {
      shouldPause: true,
      reason: `step=${opts.step} is a mode/context-selection step → always pause (defect #1 fix)`,
      gateKind: 'mode-selection-itself'
    };
  }

  if (shouldAutoProceed(opts.mode)) {
    return {
      shouldPause: false,
      reason: `mode=${opts.mode} → recommended = chosen; emit auto-decision log (D5.a)`,
      gateKind: 'mode-driven'
    };
  }

  return {
    shouldPause: true,
    reason: `mode=${opts.mode} → pause for AskUserQuestion (assisted/strict default)`,
    gateKind: 'mode-driven'
  };
}

/**
 * Format a one-line audit message for the auto-decisions log.
 * Karpathy §3: this is a pure formatter; it does NOT touch the file
 * system. The CLI / LLM is responsible for appending.
 */
export function formatAutoProceedLogLine(opts: {
  mode: SoloMode;
  step: GatedStepId;
  recommendedOption: string;
  hardFloorCategory?: HardFloorCategory | undefined;
}): string {
  if (opts.hardFloorCategory !== undefined && isHardFloorCategory(opts.hardFloorCategory)) {
    return `auto-pause (${opts.mode}, hard-floor:${opts.hardFloorCategory}): ${opts.step} → ${opts.recommendedOption}`;
  }
  return `auto-proceed (${opts.mode}): ${opts.step} → ${opts.recommendedOption}`;
}
