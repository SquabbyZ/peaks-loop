/**
 * v2.11.0 Group F (Tier 9) — D5: full-auto self-decision gate.
 *
 * Single source of truth for "should this code path auto-proceed or
 * pause for an AskUserQuestion round-trip?" The D5 design (per
 * `.peaks/memory/2026-06-26-v2-11-full-auto-self-decision.md`) requires:
 *
 *   - `full-auto` and `24h` modes → auto-proceed (recommended = chosen)
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

import {
  CODE_MODES,
  COMMIT_BOUNDARY_ACTIONS,
  COMMIT_BOUNDARY_PATTERNS,
  type CodeMode,
  type CommitBoundaryActionId,
  type GatedStepId
} from './mode-gate-types.js';

// The mode alias, the gated-step vocabulary and the commit-boundary vocabulary
// live in `mode-gate-types.ts` (wave-3 file-size cap split; declarations moved
// verbatim). Re-exported here so every importer keeps resolving them from
// `mode-gate.js` unchanged.
export {
  CODE_MODES,
  COMMIT_BOUNDARY_ACTIONS,
  COMMIT_BOUNDARY_PATTERNS,
  GATED_STEPS
} from './mode-gate-types.js';
export type { CodeMode, CommitBoundaryActionId, GatedStepId } from './mode-gate-types.js';

export type HardFloorCategory =
  | 'irreversible-external-side-effect'
  | 'authentication-credential'
  | 'multi-day-investment'
  /**
   * explicit full-auto boundary = commit only. Per user-given rule
   * from `.peaks/memory/2026-06-28-full-auto-boundary.md`: full-auto
   * ends at commit. push / tag / npm publish / global install are
   * commit-BOUNDARY side effects — they extend the commit to an
   * external system, and full-auto must NOT auto-perform them even
   * if every other mode says yes. Always pauses.
   */
  | 'commit-boundary-side-effect';

export const HARD_FLOOR_CATEGORIES: readonly HardFloorCategory[] = [
  'irreversible-external-side-effect',
  'authentication-credential',
  'multi-day-investment',
  'commit-boundary-side-effect'
] as const;

/**
 * produced this decision. The LLM-side caller (peaks-code body) reads
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
  /** Human-readable rationale; surfaces in `peaks code should-pause --json` */
  readonly reason: string;
  /** Hard-floor override applied? Surfaces in audit log when true */
  readonly hardFloorCategory?: HardFloorCategory;
  /** Slice 2026-06-28-code-mode-bypass-fix: kind of gate that produced
   * this decision. Always present; defaults to `'mode-driven'` for the
   * assisted/strict pause branch. */
  readonly gateKind: GateKind;
}

export function isCodeMode(value: string): value is CodeMode {
  return (CODE_MODES as readonly string[]).includes(value);
}

export function isHardFloorCategory(value: string): value is HardFloorCategory {
  return (HARD_FLOOR_CATEGORIES as readonly string[]).includes(value);
}

export function isCommitBoundaryAction(value: string): value is CommitBoundaryActionId {
  return (COMMIT_BOUNDARY_ACTIONS as readonly string[]).includes(value);
}

/**
 * `true` when the current mode should auto-proceed (skip the
 * AskUserQuestion round-trip). Mirrors D5.a: "recommended = chosen
 * in full-auto / 24h; always log, never silently skip".
 *
 * (parallel fan-out is now the default execution strategy in every
 * mode); `24h` replaces it as the second auto-proceed peer.
 */
export function shouldAutoProceed(mode: CodeMode): boolean {
  return mode === 'full-auto' || mode === '24h';
}

/**
 * Should the LLM emit an AskUserQuestion at `step` given `mode`?
 * Pure function: no IO, no LLM call. The LLM-side caller passes the
 * mode it loaded from skill presence, and the step it is about to
 * execute; this function returns a `GateDecision` with the rationale.
 *
 * The hard-floor categories always win — even full-auto pauses for
 * irreversible external side effects, auth/credential usage,
 * multi-day investment decisions (D5.b), and commit-boundary side
 *
 * `hardFloorCategory` is optional on the `GateDecision` so callers can
 * stamp the override into the auto-decisions log without a second
 * switch.
 */

/**
 * Hard-pause steps: these pause regardless of mode. They are the gates
 * whose decision *creates* or *recreates* the mode/state under which
 * later gates run. Auto-proceeding on them would silently fix the mode
 * without user consent (defect #1: new Code session skipped Step 1
 * AskUserQuestion because `full-auto` mode triggered `shouldAutoProceed`
 * on `step-1-mode-select` itself).
 */
const HARD_PAUSE_STEPS: ReadonlySet<GatedStepId> = new Set<GatedStepId>([
  'step-1-mode-select',
  'step-0.5-openspec-opt-in',
  'step-0.7-resume-detection'
]);

export function shouldPauseAtGate(opts: {
  mode: CodeMode;
  step: GatedStepId;
  hardFloorCategory?: HardFloorCategory | undefined;
  /**
   * mode. Reserved for the 5 commit-boundary side effects
   * (push/tag/publish/global install) that are past the user's
   * full-auto boundary. The hard-floor override ALWAYS wins — even
   * over the mode-driven auto-proceed branch.
   */
  commitBoundaryAction?: boolean | undefined;
}): GateDecision {
  if (opts.hardFloorCategory !== undefined && isHardFloorCategory(opts.hardFloorCategory)) {
    return {
      shouldPause: true,
      reason: `hard-floor category "${opts.hardFloorCategory}" always pauses regardless of mode (D5.b)`,
      hardFloorCategory: opts.hardFloorCategory,
      gateKind: 'hard-floor'
    };
  }

  // every other decision. Per the user-given rule in
  // `.peaks/memory/2026-06-28-full-auto-boundary.md` ("full-auto 只
  // 做到 commit"), push / tag / npm publish / global install must
  // AskUserQuestion even in full-auto. This is the mechanical
  // enforcement of that rule.
  if (opts.commitBoundaryAction === true) {
    return {
      shouldPause: true,
      reason:
        'commit-boundary side effect (push/tag/publish/global-install) → always pause regardless of mode (slice 002 AC-4, full-auto boundary = commit only)',
      hardFloorCategory: 'commit-boundary-side-effect',
      gateKind: 'hard-floor'
    };
  }

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
  mode: CodeMode;
  step: GatedStepId;
  recommendedOption: string;
  hardFloorCategory?: HardFloorCategory | undefined;
}): string {
  if (opts.hardFloorCategory !== undefined && isHardFloorCategory(opts.hardFloorCategory)) {
    return `auto-pause (${opts.mode}, hard-floor:${opts.hardFloorCategory}): ${opts.step} → ${opts.recommendedOption}`;
  }
  return `auto-proceed (${opts.mode}): ${opts.step} → ${opts.recommendedOption}`;
}

/**
 * commit-boundary action pattern. Returns the action id of the
 * first match, or `null` when none match. The CLI / LLM caller
 * passes the command through this function and forwards the
 * result to `shouldPauseAtGate({ commitBoundaryAction: true })` to
 * force the hard-floor pause.
 */
export function detectCommitBoundaryAction(command: string): CommitBoundaryActionId | null {
  if (typeof command !== 'string' || command.length === 0) return null;
  // Order matters: peaks-global-install is the most specific
  // (matches only the peaks-loop package name). Test that FIRST so
  // `npm install -g peaks-loop` is attributed correctly. Then
  // git-push, git-tag, npm-publish, npm-install-global.
  if (COMMIT_BOUNDARY_PATTERNS['peaks-global-install'].test(command)) {
    return 'peaks-global-install';
  }
  if (COMMIT_BOUNDARY_PATTERNS['git-push'].test(command)) {
    return 'git-push';
  }
  if (COMMIT_BOUNDARY_PATTERNS['git-tag'].test(command)) {
    return 'git-tag';
  }
  if (COMMIT_BOUNDARY_PATTERNS['npm-publish'].test(command)) {
    return 'npm-publish';
  }
  if (COMMIT_BOUNDARY_PATTERNS['npm-install-global'].test(command)) {
    return 'npm-install-global';
  }
  return null;
}
