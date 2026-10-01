// src/services/final-review/final-review-gates.ts
//
// The service verdict gates. Hoisted verbatim from final-review-service.ts
// (C wave 7 file-size split). The three gates that consult the delivery
// judgement receive it as a parameter (`delivered` / `baselineDelivered`)
// because the predicate itself stays in the service module — guard C
// pins isDelivered's single home there — and the service injects it at
// the call. Every gate body and its measured history comments are
// HEAD-text; only the parameter names at the three consult sites differ.
// The pre/post-diff gate is injected as the DELIVERED FACT (a boolean the
// service measured on the collected evidence) rather than the evidence
// array, because every fact it branches on is already in that boolean

import type { PrePostDiffResult } from './pre-post-diff.js';
import {
  SCOPE_CONTRACT_SOURCE_KEY,
  type CollectedEvidence
} from './final-review-evidence-sources.js';
import type { DimensionEvidence, DimensionKind, EvidenceItem } from './final-review-types.js';

/**
 * The honesty guarantee (D1), enforced after parsing rather than merely asked
 * for in the prompt. Prompt instructions are advisory — a model can still
 * answer `pass` — so this pass makes the property structural: a dimension with
 * no supporting evidence on disk is rewritten to `inconclusive` / `low`
 * regardless of what the model returned.
 *
 * A `fail` is never softened: it is already stricter than `inconclusive`.
 */
export function enforceEvidenceBackedVerdicts(
  dimensions: readonly DimensionEvidence[],
  evidenceAvailableFor: ReadonlySet<DimensionKind>
): readonly DimensionEvidence[] {
  return dimensions.map((dimension) => {
    if (dimension.verdict !== 'pass') return dimension;
    if (evidenceAvailableFor.has(dimension.dimension)) return dimension;
    const downgraded: DimensionEvidence = {
      ...dimension,
      verdict: 'inconclusive',
      confidence: 'low',
      summary: `${dimension.summary} [evidence-gate: verdict downgraded from "pass" to "inconclusive" — no on-disk evidence source supporting "${dimension.dimension}" was available to the reviewer.]`
    };
    return downgraded;
  });
}

/**
 * The pre/post-diff half of the honesty rule: a `pass` on
 * `existing-functionality-intact` may not outlive the baseline it claims.
 *
 * It fires whenever no baseline was DELIVERED to the reviewer, for EVERY reason:
 * no base ref resolvable, a base that resolves to HEAD itself, a project that is
 * not a git work tree at all, or a baseline that WAS computed but whose source
 * block never reached the prompt (the budget omitted it). The first three are
 * causes of a missing artifact; the last is a missing DELIVERY of an artifact
 * that exists. None of the four is a licence to trust the claim: they are the
 * CAUSE of the missing evidence, and a comparison the reviewer never saw is the
 * absence of an answer, never an answer that came back clean.
 *
 * The earlier version exempted the non-git case, reasoning that "a non-git
 * project would otherwise be permanently red". That reasoning was wrong in the
 * one way this whole primitive exists to prevent: the permanently red verdict is
 * the HONEST one (nothing was ever compared), while green-with-no-evidence is a
 * forged clean handoff. Worse, it pierced the structural gate that
 * `enforceEvidenceBackedVerdicts` exists to be — a `pass` whose supporting
 * evidence is entirely absent is downgraded there, and it must not be let
 * through by supplying a REASON for the absence.
 *
 * The version that followed it keyed on `prePostDiff.status === 'computed'` —
 * "a baseline exists on disk" read as "the reviewer saw one". Those two facts
 * separate the moment the budget omits the block, and the observed output was
 * self-contradicting: the producer's own block said `STATUS: COMPUTED` one line
 * above the source block's `STATUS: MISSING (omitted)`, the model was handed a
 * `pass` it could not have justified, and the service attached the artifact to
 * the dimension as evidence on top. `delivered` is that missing term.
 *
 * The gate also leaves its marker on the dimension whenever it fires, even if
 * that dimension is already non-`pass`: with both gates firing, the earlier
 * version's early return left only the OTHER gate's marker behind, so the
 * envelope could not tell an operator that this gate had run at all.
 */

export function enforcePrePostDiffAvailability(
  dimensions: readonly DimensionEvidence[],
  prePostDiff: PrePostDiffResult,
  baselineDelivered: boolean
): readonly DimensionEvidence[] {
  if (prePostDiff.status === 'computed' && baselineDelivered) return dimensions;
  const why =
    prePostDiff.status !== 'computed'
      ? prePostDiff.inGitWorkTree
        ? 'this is a git work tree, but no pre/post baseline diff could be produced for this run'
        : 'this project is not a git work tree, so no pre/post baseline diff can exist for it'
      : 'a baseline WAS computed for this run, but its source block was not delivered into the reviewer prompt (the evidence budget omitted it), so the reviewer never saw the comparison it would have to rest on';
  const reason =
    prePostDiff.status === 'computed'
      ? 'the artifact exists on disk but did not reach the reviewer'
      : prePostDiff.reason;
  return dimensions.map((dimension) => {
    if (dimension.dimension !== 'existing-functionality-intact') return dimension;
    const marker = `[pre-post-diff-gate: ${
      dimension.verdict === 'pass'
        ? 'verdict downgraded from "pass" to "inconclusive"'
        : `gate ran; verdict "${dimension.verdict}" is already non-"pass" and is left unchanged`
    } — ${why}. Reason: ${reason}]`;
    const annotated: DimensionEvidence = {
      ...dimension,
      summary: `${dimension.summary} ${marker}`
    };
    if (dimension.verdict !== 'pass') return annotated;
    return { ...annotated, verdict: 'inconclusive', confidence: 'low' };
  });
}

/**
 * F-NIT — `inconclusive` is the one verdict that cannot carry `high`
 * confidence. "I am highly confident that I could not tell" is the schema's
 * one self-contradicting combination, and it reads as a strong statement to the
 * human this envelope is handed to. Both service gates that produce an
 * `inconclusive` a reviewer did not write already write `low`; this closes the
 * same hole for the ones the reviewer DID write, clamping to `medium` (the
 * upper bound `references/4-dimensions.md` documents for this verdict) and
 * leaving a marker so the clamp is auditable rather than silent.
 *
 * `fail` and `pass` are untouched: their confidence says something real.
 */
export function clampInconclusiveConfidence(
  dimensions: readonly DimensionEvidence[]
): readonly DimensionEvidence[] {
  return dimensions.map((dimension) => {
    if (dimension.verdict !== 'inconclusive' || dimension.confidence !== 'high') return dimension;
    return {
      ...dimension,
      confidence: 'medium',
      summary: `${dimension.summary} [confidence-gate: confidence clamped from "high" to "medium" — an "inconclusive" verdict cannot be highly confident that it could not tell.]`
    };
  });
}

/**
 * The source whose absence from the delivered prompt is a DELIVERY failure for
 * `functional-completeness`: the approved-scope contract.
 *
 * F-SAME-SHAPE — the hole the pre/post-diff gate closes for
 * `existing-functionality-intact` was still open one dimension over. That
 * dimension's rule is "a `pass` may not outlive the source it rests on", and
 * `functional-completeness` is DEFINED against the approved scope and its
 * non-goals — `prd/handoff.md` — but its `pass` only requires SOME source in its
 * SUPPORTS list to be FOUND, and `qa-test-report` (the first source in the
 * order, so the one the budget can never starve) also supports it. Measured on
 * both saturated fixtures: `prd/handoff.md` was inlined with zero bytes on every
 * run while the dimension still came back `pass`/`high` — the contract that
 * says what "complete" meant was never shown to the reviewer judging
 * completeness. Exactly the forged-clean-handoff shape, one dimension over.
 *
 * The delivery test for this source is the module's `whole` rule (`isDelivered`),
 * not "some bytes arrived": the contract is prose whose point is the part a
 * truncation would cut (scope then non-goals), so a partial slice is not a
 * weaker version of the contract — it is a different document, and the reviewer
 * would be judging "complete" against a scope list that stops mid-sentence.
 *
 * The gate deliberately does NOT fire when the contract is `missing` — ENOENT,
 * i.e. the file is absent from the project, whether because the workflow has no
 * PRD phase or because it never wrote one. A workflow with no PRD phase has no
 * contract to lose, and reddening that dimension forever would be the "gate
 * that is always red is noise" failure this primitive already names.
 *
 * F4 — what the gate fires on is the opposite fact: the contract IS there for
 * this run and did not reach the reviewer. `totalBytes === 0` used to stand in
 * for "not there", and it was wider than the comment above it: a 0-byte
 * `prd/handoff.md` is `empty`, not `missing` — the file exists, the PRD phase
 * ran, and the reviewer received no contract at all — yet the early return
 * skipped the gate and let `functional-completeness` come back `pass`/`high`.
 * The same line collapsed `unreadable` (EACCES / EBUSY: the contract exists and
 * this process could not open it) into "no PRD phase". The test is now the
 * STATUS the read phase produced, so "there is nothing to deliver" and "there
 * is something to deliver and it did not arrive" cannot be the same branch.
 */

export function enforceScopeContractDelivery(
  dimensions: readonly DimensionEvidence[],
  collected: readonly CollectedEvidence[],
  delivered: (item: CollectedEvidence, dimension: DimensionKind) => boolean
): readonly DimensionEvidence[] {
  const block = collected.find((item) => item.source.key === SCOPE_CONTRACT_SOURCE_KEY);
  if (block === undefined || block.status === 'missing') return dimensions;
  if (delivered(block, 'functional-completeness')) return dimensions;

  return dimensions.map((dimension) => {
    if (dimension.dimension !== 'functional-completeness') return dimension;
    const marker = `[scope-contract-gate: ${
      dimension.verdict === 'pass'
        ? 'verdict downgraded from "pass" to "inconclusive"'
        : `gate ran; verdict "${dimension.verdict}" is already non-"pass" and is left unchanged`
    } — the approved-scope contract (${block.relativePath}) exists for this run, but it did not reach the reviewer in full (${block.includedBytes} of ${block.totalBytes} bytes, status "${block.status}"), so "functional-completeness" was judged without the scope and non-goals it is defined against. Reason: ${block.reason || 'inlined only in part'}]`;
    const annotated: DimensionEvidence = {
      ...dimension,
      summary: `${dimension.summary} ${marker}`
    };
    if (dimension.verdict !== 'pass') return annotated;
    return { ...annotated, verdict: 'inconclusive', confidence: 'low' };
  });
}

/**
 * Attach the computed diff to the dimension as a first-class `pre-post-diff`
 * `EvidenceItem`.
 *
 * The service does this rather than trusting the reviewer to cite the source:
 * the dimension's contract NAMES this evidence kind and this artifact path, and
 * a machine-produced fact that only appears when an LLM remembers to type it is
 * not a guarantee. Appending cannot upgrade a verdict — the gate above has
 * already run, and this only makes the artifact the verdict rests on auditable.
 *
 * It follows the same delivery rule as the gate — it asks the SAME function, on
 * purpose: attaching the artifact to a dimension whose reviewer never received
 * that block would re-create the very contradiction this layer exists to remove
 * — an envelope claiming a `pre-post-diff` evidence item next to an
 * `inconclusive` verdict that says the comparison was never seen.
 */

export function attachPrePostDiffEvidence(
  dimensions: readonly DimensionEvidence[],
  prePostDiff: PrePostDiffResult,
  baselineDelivered: boolean
): readonly DimensionEvidence[] {
  if (prePostDiff.status !== 'computed' || !baselineDelivered) return dimensions;
  const item: EvidenceItem = {
    kind: 'pre-post-diff',
    description: prePostDiff.summary,
    artifact: prePostDiff.relativePath
  };
  return dimensions.map((dimension) => {
    if (dimension.dimension !== 'existing-functionality-intact') return dimension;
    const alreadyPresent = dimension.evidence.some(
      (existing) => existing.kind === 'pre-post-diff' && existing.artifact === item.artifact
    );
    if (alreadyPresent) return dimension;
    return { ...dimension, evidence: [...dimension.evidence, item] };
  });
}
