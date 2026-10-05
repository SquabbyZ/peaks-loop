/**
 * orchestrator-can-do-advisories.js — the pure message side of
 * `buildOrchestratorCanDoResult` (see `./orchestrator-can-do.ts`).
 *
 * Hoisted out of that module by slice c2w1 of `strict-remediation-abc` without
 * touching one predicate, one branch order, or one byte of message text: the
 * strings below are the probe's wire contract, consumed by skill prose and by
 * the `pre-tool-code-gate` hook contract.
 */

export const ORCHESTRATOR_REDLINE_RATIO = 0.95;
export const ORCHESTRATOR_PRECOMPACT_RATIO = 0.85;

/** The four Q signals that produce blockers / warnings / suggestions here. */
export interface BoundarySignals {
  readonly q1HardBlockedPath: boolean;
  readonly q2SubAgentAvailable: boolean;
  readonly q3RequiresUserDecision: boolean;
  readonly q4ContextRatio: number;
}

export interface BoundaryAdvisories {
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  readonly suggestions: readonly string[];
}

/**
 * Build the blockers / warnings / suggestions carried by Q1 (hard), Q2, Q4 and
 * Q3, in exactly the order `buildOrchestratorCanDoResult` used to push them.
 */
export function boundaryAdvisories(signals: BoundarySignals): BoundaryAdvisories {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const suggestions: string[] = [];

  // the slice-spec mentions any hard-blocked path family
  // (src/, tests/unit/, tests/integration/, config/, bin/, scripts/),
  // the orchestrator MUST refuse direct execution and force sub-agent
  // dispatch. This is the LLM-side complement to the
  // `pre-tool-code-gate.sh` PreToolUse hook.
  if (signals.q1HardBlockedPath) {
    blockers.push(
      'requires-sub-agent-dispatch: slice-spec mentions a hard-blocked path family ' +
        '(src/, tests/unit/, tests/integration/, config/, bin/, scripts/); ' +
        'orchestrator MUST NOT Edit/Write these directly. Use peaks sub-agent dispatch rd.'
    );
  }

  // Q2 — sub-agent availability is a hard precondition.
  if (!signals.q2SubAgentAvailable) {
    blockers.push('sub-agent dispatch unavailable (peaks sub-agent dispatch --help failed)');
    suggestions.push('verify peaks CLI is on PATH; check `peaks --version`');
  }

  // Q4 — context ratio. ≥0.95 → red-line; ≥0.85 → pre-compact. A WARNING, not
  //
  // Why this is not a blocker any more, and why it is not an oversight:
  //
  //   The peak this answers is "can this slice run in the current session".
  //   Context ratio cannot answer "no" to it. The reason is the one the
  //   OTHER face of this same threshold: peaks-loop has no executor for a
  //   running session, so it cannot compact its way out of a high ratio —
  //   `evaluateCompactTrigger` therefore says of the red line "peaks-loop has
  //   asked the harness to compact and is WAITING for it — sub-agent dispatch
  //   is NOT blocked; carry on and re-probe". A probe that returned
  //   `canDoInSession: false` here would contradict that sentence for the same
  //   0.95 on the same number, and its only programmatic consumer
  //   (`code-orchestrator-can-do.ts`) turns the false into exit code 1 — i.e.
  //   it would re-open, at the CLI layer, exactly the deadlock T3 deleted.
  //
  //   Nor does the pre-compact zone (0.85–0.95) earn a blocker: the trigger's
  //   message there is "peaks-loop already fired the auto-compact pathway; the
  //   LLM does not need to act", which is the opposite of "you may not proceed".
  //
  //   What a blocker would still need to be true: THE ORCHESTRATOR itself
  //   cannot continue. It can — the slice's edits are delegated to a sub-agent
  //   (Q1), and the orchestrator's own context is only spent co-ordinating.
  //
  //   So the ratio is reported, warned about, and given a next action; the
  //   verdict is left to the blockers that really are un-survivable (a
  //   hard-blocked path family, an unreachable sub-agent dispatcher).
  if (signals.q4ContextRatio >= ORCHESTRATOR_REDLINE_RATIO) {
    warnings.push(
      `context red-line (ratio=${signals.q4ContextRatio.toFixed(2)} ≥ ${ORCHESTRATOR_REDLINE_RATIO}): peaks-loop has asked the harness to compact and is waiting for it; dispatch is NOT blocked — carry on and re-probe with \`peaks code context-now\``
    );
    suggestions.push('peaks code auto-compact');
  } else if (signals.q4ContextRatio >= ORCHESTRATOR_PRECOMPACT_RATIO) {
    warnings.push(
      `context near limit (ratio=${signals.q4ContextRatio.toFixed(2)} ≥ ${ORCHESTRATOR_PRECOMPACT_RATIO}): in the pre-compact band; peaks-loop fires the auto-compact pathway itself and dispatch is NOT blocked`
    );
    suggestions.push('peaks code auto-compact');
  }

  // Q3 — user-decision keywords → soft warning, NOT a blocker. The
  // LLM should AskUserQuestion, which is cheap.
  if (signals.q3RequiresUserDecision) {
    warnings.push('slice-spec contains decision keywords; AskUserQuestion before proceeding');
  }

  return { blockers, warnings, suggestions };
}
