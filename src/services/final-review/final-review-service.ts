// src/services/final-review/final-review-service.ts
//
// The final-review service — public entry point. C wave 7 split its
// 1,857-line module into cohesive siblings in this directory
// (contract, evidence-budget, output-budget, evidence-sources,
// evidence-collect, prompt, delivery, gates, verdicts, reviewer,
// fifth-dim, runner). Every public name is re-exported below, so no
// importer's path or symbol changed.
//
// What stays HERE, deliberately: the delivery predicate and the
// dimension-routing gates that tests/unit/final-review/final-review-
// service.test.ts (guard C) pins by parsing this file — guard C reads
// THIS path only, and the test file is not this leaf to edit. The three
// gate implementations moved to final-review-gates.ts with the delivery
// judgement injected (their measured-history comments moved with them,
// attached); the thin same-named wrappers below are the routing the
// guard's by-name assertions read. evidenceSourcesFor keeps its
// function here because the guard regexes its table; the nine base
// sources it now composes live in final-review-evidence-sources.ts

import {
  API_DIFF_ARTIFACT_SEGMENTS,
  PRE_POST_DIFF_VERDICT_MARKER,
  type PrePostDiffResult
} from './pre-post-diff.js';
import {
  baseEvidenceSources,
  PRE_POST_DIFF_SOURCE_KEY,
  type CollectedEvidence,
  type EvidenceSource
} from './final-review-evidence-sources.js';
import {
  attachPrePostDiffEvidence as gateAttachPrePostDiffEvidence,
  enforcePrePostDiffAvailability as gateEnforcePrePostDiffAvailability,
  enforceScopeContractDelivery as gateEnforceScopeContractDelivery
} from './final-review-gates.js';
import {
  IncompleteFinalReviewError,
  type LlmRunner,
  type PrepareFinalReviewOptions
} from './final-review-contract.js';
import type { DimensionEvidence, DimensionKind } from './final-review-types.js';

type _LlmRunnerRef = LlmRunner;

export { IncompleteFinalReviewError, type LlmRunner, type PrepareFinalReviewOptions };

/**
 * The on-disk sources, in allocation order.
 *
 * `prePostDiffAvailable` is the ONE conditional member, and it is opt-in rather
 * than always-present: the `pre-post-diff` producer writes
 * `final-review/api-diff.txt` only when it actually computed a baseline (see
 * `pre-post-diff.ts`), so when the artifact is absent there is nothing behind
 * that source at all. Rendering a permanently-MISSING tenth block would add
 * prompt bytes to every run and hide nothing — the producer's own status block
 * (`renderPrePostDiffStatus`) states the absence and the reason to the reviewer
 * in as many words. When the artifact IS there, it is appended LAST so it
 * cannot displace the byte-allocation order the other nine sources rely on.
 *
 * Being appended last is also why it was the FIRST source the budget dropped —
 * see MAX_EVIDENCE_BYTES_TOTAL for the measurement. Appending it last stays
 * correct for the other nine sources; what changed is that a `pass` on this
 * dimension now requires the block to have been DELIVERED, not merely computed.
 */

export function evidenceSourcesFor(
  rid: string,
  prePostDiffAvailable: boolean
): readonly EvidenceSource[] {
  const sources: EvidenceSource[] = baseEvidenceSources(rid);

  if (prePostDiffAvailable) {
    sources.push({
      key: PRE_POST_DIFF_SOURCE_KEY,
      label: 'Pre/post structural baseline diff (test surface + public API surface)',
      segments: [...API_DIFF_ARTIFACT_SEGMENTS],
      // The dimension's own contract asks for a `pre-post-diff`; this is the
      // only source in the set that is one.
      supports: ['existing-functionality-intact'],
      // The one source whose producer publishes its conclusion as a literal:
      // the artifact opens with its `VERDICT:` line, so delivery is checkable
      // against the BYTES the reviewer received rather than against the size of
      // the slice it happened to get.
      delivery: { kind: 'conclusion', marker: PRE_POST_DIFF_VERDICT_MARKER }
    });
  }

  return sources;
}

/**
 * Which dimensions the reviewer was actually given evidence FOR. A dimension
 * absent from this set has no delivered evidence behind it.
 *
 * mentions this dimension was inlined (at least a byte of it)". Two things were
 * wrong with that, and both are the same thing: it asked about the SOURCE (was
 * it included) instead of about the DIMENSION (was its evidence seen), and it
 * answered with whatever the allocator's unit happened to be. Measured on this
 * repo's own run, eight of the ten sources are larger than the per-file cap, so
 * every dimension's evidence set was the cap-sized HEAD of a document — and a
 * head can be a table of contents while the findings live past the cut (QA
 * reproduced exactly that: one 20,545-byte source whose first 10,240 bytes are
 * front matter, four `pass`/`high` verdicts). "Some bytes of a source that
 * lists this dimension" is not evidence; the source's conclusion is.
 *
 * It now delegates, one dimension at a time, to the module's single delivery
 * judgement — so a source that cannot be delivered for a dimension cannot back
 * a pass on it either, here or anywhere else.
 */
export function dimensionsWithEvidence(
  collected: readonly CollectedEvidence[]
): ReadonlySet<DimensionKind> {
  const available = new Set<DimensionKind>();
  for (const item of collected) {
    for (const dimension of item.source.supports) {
      if (isDelivered(item, dimension)) available.add(dimension);
    }
  }
  return available;
}

/**
 * DELIVERED — the module's ONE delivery judgement.
 *
 * A source is delivered TO A DIMENSION when the bytes the reviewer actually
 * received carry the source's conclusion FOR THAT DIMENSION. Nothing else is
 * consulted: not the file's existence, not `status`, not a byte count. The
 * question it answers is "did the reviewer see this dimension's supporting
 * content?", never "was this source included?".
 *
 * Why one predicate and not four. Every one of the six holes this primitive has
 * shipped was the same shape: a local predicate that was satisfied by a PROXY
 * for delivery — the substring's presence, the stub's usefulness, "this is not
 * a git repo", `status === 'computed'`, `status === 'found'`, and finally
 * `totalBytes === 0` / `status !== 'found'` in two more places. Each fix was
 * correct where it was applied, and the shape reappeared next door because
 * "was it delivered?" had as many answers as there were call sites. There is
 * now one: this function, reading one declaration per source
 * (`EvidenceSource.delivery`).
 *
 * The two rules are the two ways a conclusion can be said to have arrived:
 *  - `whole` — the whole document arrived. A truncated document is not a
 *    weaker version of itself; the conclusion may be in the part that was cut.
 *    This is the rule everywhere the producer is another role's skill and
 *    publishes no conclusion literal: the module may not guess where a
 *    document's conclusion lives.
 *  - `conclusion(marker)` — the literal that IS the conclusion is among the
 *    bytes received.
 *
 * F-BLOCK-1BYTE — `found` was read as "delivered", and `found` was defined by a
 * byte COUNT, so 1 byte of a 4,226-byte artifact passed for a delivered
 * comparison. A count can be satisfied by a fragment; a conclusion cannot.
 *
 * A dimension the source does not SUPPORT is never delivered: `supports` is a
 * claim about what a document can evidence, and reading it as "the reviewer saw
 * this dimension's evidence" is exactly the presence-as-substance error. The
 * check lives here so no caller can skip it.
 */
export function isDelivered(item: CollectedEvidence, dimension: DimensionKind): boolean {
  if (!item.source.supports.includes(dimension)) return false;
  // No bytes arrived at all: missing, empty, unreadable, omitted.
  if (item.status !== 'found') return false;
  const rule = item.source.delivery;
  switch (rule.kind) {
    case 'whole':
      return item.totalBytes > 0 && item.includedBytes === item.totalBytes;
    case 'conclusion':
      return item.content.includes(rule.marker);
  }
}

/**
 * Was the pre/post-diff source delivered to the dimension it exists for?
 *
 * Kept as a name because three call sites share it and the reason they share it
 * is the point: the gate, the artifact attachment and the evidence set must all
 * mean the same thing by "the reviewer saw the comparison". It reads the ONE
 * predicate; it does not re-decide anything.
 */
export function prePostDiffDelivered(collected: readonly CollectedEvidence[]): boolean {
  const block = collected.find((item) => item.source.key === PRE_POST_DIFF_SOURCE_KEY);
  return block !== undefined && isDelivered(block, 'existing-functionality-intact');
}

/**
 * Routing for the verdict gates (their implementations, with their
 * measured-history comments, live in final-review-gates.ts). This module
 * owns the delivery judgement — guard C pins isDelivered's single home
 * here — so the gates are called through it: the pre/post gate receives
 * the delivered fact, the scope gate receives the predicate itself.
 */
export function enforcePrePostDiffAvailability(
  dimensions: readonly DimensionEvidence[],
  prePostDiff: PrePostDiffResult,
  collected: readonly CollectedEvidence[]
): readonly DimensionEvidence[] {
  return gateEnforcePrePostDiffAvailability(
    dimensions,
    prePostDiff,
    prePostDiffDelivered(collected)
  );
}

export function enforceScopeContractDelivery(
  dimensions: readonly DimensionEvidence[],
  collected: readonly CollectedEvidence[]
): readonly DimensionEvidence[] {
  return gateEnforceScopeContractDelivery(dimensions, collected, (item, dimension) =>
    isDelivered(item, dimension)
  );
}

export function attachPrePostDiffEvidence(
  dimensions: readonly DimensionEvidence[],
  prePostDiff: PrePostDiffResult,
  collected: readonly CollectedEvidence[]
): readonly DimensionEvidence[] {
  return gateAttachPrePostDiffEvidence(dimensions, prePostDiff, prePostDiffDelivered(collected));
}

/**
 * True when the reply ends INSIDE a JSON string or with brackets still open —
 * i.e. it was cut off mid-structure rather than being malformed. Distinguishing
 * the two is the whole point: "the reply is not JSON" sends an operator looking
 * for a schema bug, when the real cause is that nobody raised the output
 * budget after the prompt grew.
 *
 * A minimal scanner is enough — braces and quotes inside string literals are
 * skipped, escapes are honoured, and the text is never parsed.
 */
export function looksTruncated(text: string): boolean {
  let inString = false;
  let escaped = false;
  let depth = 0;
  for (const char of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{' || char === '[') depth += 1;
    else if (char === '}' || char === ']') depth -= 1;
  }
  return inString || depth > 0;
}

export {
  assertFloorReservationAffordable,
  MAX_EVIDENCE_BYTES_PER_FILE,
  MAX_EVIDENCE_BYTES_TOTAL
} from './final-review-evidence-budget.js';
export {
  EVIDENCE_BYTES_PER_OUTPUT_TOKEN,
  HARD_MAX_OUTPUT_TOKENS,
  MAX_OUTPUT_TOKENS,
  MAX_OUTPUT_TOKENS_ENV,
  MIN_OUTPUT_TOKENS,
  outputBudgetForEvidence,
  REASONING_HEADROOM_TOKENS,
  resolveOutputBudget
} from './final-review-output-budget.js';
export { EmptyReviewReplyError, MAX_EMPTY_REPLY_ATTEMPTS } from './final-review-reviewer.js';
export {
  type UndeliverableDimensionEvidence,
  undeliverableDimensions
} from './final-review-delivery.js';
export { prepareFinalReview } from './final-review-runner.js';
export { decideFifthDimension } from './final-review-fifth-dim.js';
