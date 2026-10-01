// src/services/final-review/final-review-verdicts.ts
//
// F2 — reading the delivered conclusion — and the derived allPass /
// needsAttention summary. Hoisted verbatim from final-review-service.ts
// (C wave 7 file-size split).

import type { PrePostDiffConclusion } from './pre-post-diff.js';
import type { DimensionEvidence, DimensionKind } from './final-review-types.js';

/**
 * F2 — read what the delivered conclusion SAYS, and make a detected drift
 * impossible to hand over as "nothing needs attention".
 *
 * The layer that made delivery a machine fact stopped one step short: it
 * verified that the reviewer received the `VERDICT:` line and then threw the
 * line away, keeping only a boolean. Measured (QA round 5, one export removed,
 * the model replying 4/4 `pass`):
 *
 *   VERDICT: STRUCTURAL DRIFT DETECTED — ... 1 export name(s).
 *   existing-functionality-intact: pass/high
 *   allPass: true | needsAttention: []
 *
 * — an envelope that says "clean handoff" directly above the evidence it
 * attached itself, whose first line says a removal was detected. That is the
 * same shape as every other hole here: a check that ran, whose RESULT was never
 * consumed, so the check's presence was mistaken for its verdict.
 *
 * The verdict is deliberately NOT forced to `fail`: a removal can be authorized
 * by the approved scope, and that judgement belongs to the reviewer and to the
 * human. What is refused is SILENCE — a drift the service detected is a
 * dimension a human has to look at, so it is named in `needsAttention` (which
 * also clears `allPass`: a handoff with an open question is not a clean one)
 * and its dimension says so in its own summary.
 *
 * `indeterminate` counts too. A delivered conclusion this service cannot
 * classify is not "no drift" — it is a conclusion nobody read, which is the
 * defect this function exists to close, so it is surfaced rather than dropped.
 */
export function enforceStructuralDriftAttention(
  dimensions: readonly DimensionEvidence[],
  deliveredConclusion: PrePostDiffConclusion | null
): { readonly dimensions: readonly DimensionEvidence[]; readonly mustAttend: boolean } {
  // `null` is "no conclusion was DELIVERED" — the gate above owns that case. It
  // must not be folded into `indeterminate`: a project with no baseline has not
  // delivered an unreadable conclusion, it has delivered none, and saying
  // otherwise would put a false "the comparison was never read" marker on every
  // non-git run.
  if (deliveredConclusion === null) return { dimensions, mustAttend: false };
  if (deliveredConclusion === 'no-drift' || deliveredConclusion === 'additions-only') {
    return { dimensions, mustAttend: false };
  }
  const what =
    deliveredConclusion === 'drift-detected'
      ? 'the delivered pre/post baseline diff reports STRUCTURAL DRIFT DETECTED'
      : 'the delivered pre/post baseline diff carries a VERDICT line this service cannot classify, so the comparison was never actually read';
  return {
    dimensions: dimensions.map((dimension) => {
      if (dimension.dimension !== 'existing-functionality-intact') return dimension;
      return {
        ...dimension,
        summary: `${dimension.summary} [pre-post-diff-drift-gate: ${what}. The removal may well be authorized by the approved scope — that is the reviewer's and the human's call — but a detected drift is never "nothing needs attention": this dimension is listed in needsAttention and allPass is false.]`
      };
    }),
    mustAttend: true
  };
}

/**
 * `allPass` / `needsAttention` are DERIVED from the verdicts, never copied
 * verbatim from the model's own summary fields: a model that writes a fabricated
 * `pass` line plus a matching `allPass: true` would otherwise produce exactly
 * the forged clean handoff this primitive exists to prevent, and once the gate
 * above rewrites a verdict the two would silently disagree.
 *
 * Both fields are only ever NARROWED, never widened — `allPass` cannot become
 * true unless the model also said true and no dimension is non-`pass`, and a
 * dimension the model itself flagged is never dropped from `needsAttention`.
 */
export function summarizeVerdicts(
  dimensions: readonly DimensionEvidence[],
  modelFlags: { readonly allPass: unknown; readonly needsAttention: unknown },
  /**
   * Dimensions the SERVICE must flag whatever the model said — today, the one
   * F2 names when the delivered baseline reports structural drift. A handoff
   * with a machine-detected drift in it is not clean, so this also clears
   * `allPass`, exactly as a non-`pass` verdict does.
   */
  mustAttend: readonly DimensionKind[] = []
): {
  readonly allPass: boolean;
  readonly needsAttention: readonly DimensionKind[];
} {
  const nonPass = dimensions.filter((d) => d.verdict !== 'pass').map((d) => d.dimension);
  const flaggedByModel = Array.isArray(modelFlags.needsAttention)
    ? (modelFlags.needsAttention as readonly DimensionKind[])
    : [];
  return {
    allPass:
      modelFlags.allPass !== false &&
      dimensions.length > 0 &&
      nonPass.length === 0 &&
      mustAttend.length === 0,
    needsAttention: [...new Set<DimensionKind>([...flaggedByModel, ...nonPass, ...mustAttend])]
  };
}
