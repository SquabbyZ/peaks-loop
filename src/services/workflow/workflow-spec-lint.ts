/**
 * peaks-workflow v3.0.0 — `lintWorkflowSpec` (moved verbatim per rid-006)
 *
 * Pure lint over a typed `WorkflowSpec`. No parser/build helpers, no
 * YAML helpers — lint is pure on the typed spec. The slimmed
 * `workflow-spec.ts` re-exports `lintWorkflowSpec` under its original
 * name so existing call sites compile unchanged.
 *
 * File budget: ≤ 400 lines (rid-006 split).
 */

import type { WorkflowLintReport, WorkflowSpec } from './workflow-spec-types.js';

/** Lint a parsed spec — returns a report with semantic errors / warnings. */
export function lintWorkflowSpec(spec: WorkflowSpec): WorkflowLintReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Phase ids must be unique.
  const seen = new Set<string>();
  for (const phase of spec.phases) {
    if (seen.has(phase.id)) errors.push(`duplicate phase id "${phase.id}"`);
    seen.add(phase.id);
  }

  // Gate references in phases must exist in the gates list (or be a known
  // built-in like "Gate B3").
  const gateIds = new Set(spec.gates.map((g) => g.id));
  for (const phase of spec.phases) {
    for (const gateRef of phase.gates) {
      if (!gateIds.has(gateRef) && !gateRef.startsWith('Gate ')) {
        warnings.push(`phase "${phase.id}" references unknown gate "${gateRef}" (not in gates[] and not a built-in "Gate …" label)`);
      }
    }
  }

  // Evaluator gates must match a gate id when present.
  for (const ev of spec.evaluators) {
    if (ev.gate !== undefined && !gateIds.has(ev.gate) && !ev.gate.startsWith('Gate ')) {
      warnings.push(`evaluator "${ev.type}" references unknown gate "${ev.gate}"`);
    }
  }

  // dependsOn references must resolve.
  const phaseIds = new Set(spec.phases.map((p) => p.id));
  for (const phase of spec.phases) {
    if (phase.dependsOn !== undefined) {
      for (const dep of phase.dependsOn) {
        if (!phaseIds.has(dep)) errors.push(`phase "${phase.id}" depends on missing phase "${dep}"`);
      }
    }
  }

  // Parallel groups must contain ≥2 phases.
  const groupCounts = new Map<string, number>();
  for (const phase of spec.phases) {
    if (phase.parallelGroup !== undefined) {
      groupCounts.set(phase.parallelGroup, (groupCounts.get(phase.parallelGroup) ?? 0) + 1);
    }
  }
  for (const [group, count] of groupCounts) {
    if (count < 2) warnings.push(`parallelGroup "${group}" has only ${count} phase(s); parallelism requires ≥2`);
  }

  // Budget sanity.
  if (spec.budget.cycles !== undefined && spec.budget.cycles < 1) {
    errors.push(`budget.cycles must be ≥1 when set (got ${spec.budget.cycles})`);
  }
  if (spec.budget.tokens !== undefined && spec.budget.tokens < 1) {
    errors.push(`budget.tokens must be ≥1 when set (got ${spec.budget.tokens})`);
  }
  if (spec.budget.wallSeconds !== undefined && spec.budget.wallSeconds < 1) {
    errors.push(`budget.wallSeconds must be ≥1 when set (got ${spec.budget.wallSeconds})`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    normalizedSpec: spec
  };
}