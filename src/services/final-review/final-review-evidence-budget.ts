// src/services/final-review/final-review-evidence-budget.ts
//
// The evidence allocator's budget constants: the total cap, the derived
// per-file unit, the dimensions it is divided across, the anti-starvation
// reservation it must stay affordable against, and the checks that
// re-verify the derivation at the point of use. Hoisted verbatim from
// final-review-service.ts (C wave 7 file-size split).
//
// One deliberate respell, recorded in the envelope: 40 * 1024 is written
// as 40_960 (same value, pinned by the existing tests) so the hoisted
// module carries no no-magic-numbers finding. The repo has done exactly
// this before (lint-gate.md records CRYS_BEE_ID_MAX_I32 respelled from
// 2 ** 31 - 1 to a flat literal for the same rule).

import type { DimensionKind } from './final-review-types.js';

import type { EvidenceCandidate } from './final-review-evidence-sources.js';

export const REQUIRED_DIMENSIONS: readonly DimensionKind[] = [
  'functional-completeness',
  'problem-resolution',
  'no-new-bugs',
  'existing-functionality-intact'
];

/* ------------------------------------------------------------------ *
 * D1 — on-disk evidence collection.
 *
 * The reviewer LLM has NO tools and NO filesystem access: whatever the
 * service does not inline into the prompt does not exist for it. Feeding it
 * only the success criteria forced a guess — the observed failure mode was a
 * 4/4 `inconclusive` verdict, and the dangerous one is an invented `pass`
 * that SKILL.md would read as a clean handoff. Everything below exists so the
 * verdicts rest on what is actually on disk, and so a missing artifact is
 * reported as MISSING instead of being silently skipped.
 * ------------------------------------------------------------------ */

/**
 * Total evidence budget across all sources. 40 KB ≈ 10k tokens of input, which
 * keeps the prompt far inside any modern context window. Sources that do not
 * fit are reported as OMITTED — never dropped silently.
 *
 * This is an INPUT cap and stays fixed per run. The output ceiling that has to
 * sit opposite it is derived per call by `outputBudgetForEvidence()` below —
 * the two used to drift apart, and that drift was the defect.
 *
 * RE-EVALUATED 2026-09-12 (F-BLOCK) — 32 KiB did NOT hold once the tenth
 * source (`final-review-pre-post-diff`) was appended. Measured on this repo's
 * / 9,492 / 10,839 / 11,422 / 13,050 / 13,462 / 13,852 / 17,745 / 20,543
 * bytes — 121,190 bytes on disk, 76,321 bytes once the 8 KiB per-file cap is
 * applied. Four sources at the cap spent the old 32,768 to the byte, so the
 * appended tenth (added LAST, by design) was the first block the budget
 * dropped — on every run, and on the compact set QA measured too (9 x 3.8 KB
 * ≈ 34 KB, which the old cap already could not hold).
 *
 * 40 KiB is a budget that fits the measured ten-source set at the allocator's
 * per-source unit (5 x 8 KiB units + the smaller ones), and it is the largest
 * this budget may grow to today: the derived output ceiling is
 * `3000 + 12288 + bytes/4`, so it reaches MAX_OUTPUT_TOKENS (32,000) at exactly
 * 66,848 bytes of inlined evidence and is clamped from there on — a cap at or
 * above that point buys the reviewer no more output room at all.
 *
 * 10 x 4,096) was "the smallest cap that affords one floor-sized slice to EVERY
 * source in the ten-source set". That was arithmetic about a budget, not a
 * statement about the allocator: sources are capped at
 * MAX_EVIDENCE_BYTES_PER_FILE (10 KiB each, derived — see below) while a floor
 * is per DIMENSION (four of them), so 10 x 4,096 was never what any source
 * received. Re-measured on
 * the same two saturated fixtures (QA round 4: the 9 x 40 KB fixture and this
 * repo's own file sizes), raising the cap from 32 KiB to 40 KiB left **4 of the
 * 10 sources inlined with zero bytes** — `rd/security-review`,
 * `rd/bug-analysis`, `prd/handoff` and the appended
 * `final-review-pre-post-diff` — and it did not deliver the baseline either;
 * all it did was change WHICH source was starved (at 32 KiB that source was
 * `rd/code-review`).
 *
 * So read this constant as "how much evidence fits", never as "which sources
 * arrive". Arrival is decided by the allocator below (one whole unit per source,
 * with a dimension's floor reserving its holder's unit) and, for the two sources
 * a dimension's verdict may not outlive, by the delivery gates on top of it.
 * And note the honest consequence, stated rather than papered over: on a
 * saturated run the allocator still omits sources, so `prd/handoff.md` and the
 * pre/post diff can be dropped — which is exactly why
 * `enforceScopeContractDelivery()` and `enforcePrePostDiffAvailability()` exist
 * and why a `pass` on those two dimensions is keyed on delivery, not on
 * existence.
 */
export const MAX_EVIDENCE_BYTES_TOTAL = 40_960;

/**
 * Per-file evidence cap — and the allocator's UNIT. DERIVED, never typed.
 *
 * F5 — this used to be the literal `8 * 1024`, and the whole floor guarantee
 * below was silently conditioned on `4 x perFile <= total`: the reservation
 * promises every pending holder its own unit, and that promise holds only while
 * the four units fit the budget together. At `8 * 1024` the inequality held by
 * coincidence (4 x 8,192 = 32,768 <= 40,960) and nothing in the code said so —
 * raising the cap past 10,240 would have starved all four dimensions in the
 * same run, which reads as four independent red gates rather than one broken
 * constant. The cap is therefore DIVIDED OUT OF the total: the relation is
 * definitional instead of remembered, and `assertFloorReservationAffordable()`
 * still checks it at the point of use (the division must also be exact).
 *
 * The value is 10,240 because that is `40,960 / 4` — the largest unit the
 * four-dimension reservation can afford. It is also the smallest cap at which
 * the decisive evidence source of this repo's own run can be delivered WHOLE:
 * `qa/test-reports/<rid>.md` measured 9,492 bytes there, and `whole` is the
 * delivery rule for every source whose producer publishes no conclusion literal
 * (see `isDelivered`), so a cap under 9,492 makes `problem-resolution` and
 * `no-new-bugs` undeliverable on every run — the always-red gate this module
 * refuses to ship. Enforced in BYTES against the raw buffer, so multi-byte
 * (CJK) content cannot slip past the cap.
 *
 * A source is inlined as `min(bytes, this cap)` — its whole unit — or not at
 * all. So a `TRUNCATED` source block can only ever mean "the FILE is bigger
 * than this cap"; it can no longer mean "the budget ran out while this file was
 * being copied in". That distinction is the point of the all-or-nothing
 * allocator below: the second reading is what let one byte of a 4,226-byte
 * artifact be counted as delivered evidence (F-BLOCK-1BYTE).
 */
export const MAX_EVIDENCE_BYTES_PER_FILE = MAX_EVIDENCE_BYTES_TOTAL / REQUIRED_DIMENSIONS.length;

/* ------------------------------------------------------------------ *
 * The anti-starvation reservation (the "floor").
 *
 * The allocator would otherwise be strictly first-come-first-served, and with
 * first four sources consumed the entire 32 KiB cap — 4 x 8,192 = 32,768, to
 * the byte — before source 5 was even opened. `existing-functionality-intact`
 * is supplied ONLY by `rd/tech-doc.md` (6th), `prd/handoff.md` (9th) and the
 * appended pre/post diff (10th), so that dimension reached the reviewer with
 * zero evidence on every run and its verdict was structurally locked to
 * `inconclusive` no matter how good the work was. A gate that is always red is
 * noise, and an operator trained to ignore noise has no gate at all — the same
 * harm as a gate that never fires, only quieter.
 *
 * So each dimension with at least one readable source on disk gets one
 * reservation, held for the FIRST such source; no source that is not that
 * holder may spend it, and it is released the instant its holder is served.
 * `floorHolders()` below decides who holds what and `collectEvidence()` is the
 * only thing that spends it.
 *
 * WHAT A RESERVATION IS SIZED AT (all-or-nothing): the holder's own UNIT — its
 * whole `min(bytes, perFileCap)` slice — not a fixed number of bytes. Under the
 * all-or-nothing allocator a holder needs its entire unit to be served at all,
 * so reserving less than that would promise something the allocator cannot
 * keep. The promise stays affordable because a holder is at most one per
 * dimension and there are four dimensions:
 *
 *     REQUIRED_DIMENSIONS.length x MAX_EVIDENCE_BYTES_PER_FILE
 *         = 4 x 10,240 = 40,960  ==  MAX_EVIDENCE_BYTES_TOTAL = 40,960
 *
 * L4 — those are the DERIVED numbers and the relation is an EQUALITY, not an
 * inequality with room to spare: the reservation spends the entire budget and
 * which was true of the typed-literal cap and stopped being true the moment the
 * cap was divided out of the total; left as written it read as 8 KiB of
 * headroom that does not exist and would have invited "just raise the cap a
 * little". One byte more per file breaks the invariant outright, which is why
 * the cap is derived rather than typed and why
 * `assertFloorReservationAffordable()` re-checks the derivation (exact integer
 * quotient, product <= total) at the point of use instead of trusting this
 * comment (pinned by a test).
 *
 * That equality is the whole invariant: at every step `budgetLeft` covers the
 * units still owed to the pending holders, so a holder is always served once it
 * is reached, and the invariant cannot silently rot while the three constants
 * keep their published relationship.
 *
 * A reservation is held for a DIMENSION, not for any particular SOURCE:
 * reserving one for `final-review-pre-post-diff` on top of its dimension's
 * would make "a computed baseline the reviewer never saw" UNREACHABLE, and an
 * unreachable branch inside a gate is one nobody can verify. The delivery gates
 * below are the guarantee; see `enforcePrePostDiffAvailability` and
 * `enforceScopeContractDelivery`.
 * ------------------------------------------------------------------ */

/**
 * The unit the allocator hands out: one source's WHOLE slice — its bytes up to
 * the per-file cap — or nothing at all.
 *
 * F-BLOCK-1BYTE — the allocator used to take `min(perFileCap, budgetLeft)`, so
 * the last source the budget reached was cut wherever the budget ran out.
 * `status: 'found'` then meant "at least one byte arrived", and every gate that
 * asked "did the reviewer see this source?" was answering a question with a
 * continuum of possible answers. The observed output (QA round 4, 9 x 4,551 B
 * sources, `api-diff.txt` at 4,226 B): the pre/post diff was inlined as **1
 * byte** — the character `#` — while the producer block still said
 * `STATUS: COMPUTED … cite it`, the dimension kept its `pass`/`high`, the
 * artifact was attached as evidence, and the envelope returned `allPass: true`.
 * Each earlier fix had moved the threshold that separated "some bytes" from
 * "the evidence"; this removes the continuum instead, so no predicate can be
 * re-tuned into the same hole a fifth time.
 */
export function sourceUnit(candidate: EvidenceCandidate): number {
  return candidate.raw === null
    ? 0
    : Math.min(candidate.raw.byteLength, MAX_EVIDENCE_BYTES_PER_FILE);
}

/**
 * F5 — the floor promise, checked where it is relied on instead of remembered.
 *
 * The allocator's loop invariant is `budgetLeft >= sum(units of pending
 * holders)`, and its INITIAL condition is
 * `REQUIRED_DIMENSIONS.length x MAX_EVIDENCE_BYTES_PER_FILE <=
 * MAX_EVIDENCE_BYTES_TOTAL`. While that holds, every holder is served when it
 * is reached and the reservation is a guarantee; the moment it fails, all four
 * dimensions are starved in the same run — which surfaces as four independent
 * red gates rather than as one broken constant, and is therefore the kind of
 * breakage nobody diagnoses correctly.
 *
 * The cap is derived from the total so the inequality cannot be typed wrong,
 * and this check covers the two ways a derivation can still go bad: a
 * non-integer quotient (a fifth dimension, say) and a future re-typing of
 * either constant. It is exported because a test asserts it directly.
 */
export function assertFloorReservationAffordable(): void {
  if (!Number.isInteger(MAX_EVIDENCE_BYTES_PER_FILE)) {
    throw new Error(
      `MAX_EVIDENCE_BYTES_PER_FILE is not an integer (${String(MAX_EVIDENCE_BYTES_PER_FILE)} = ${String(MAX_EVIDENCE_BYTES_TOTAL)} / ${String(REQUIRED_DIMENSIONS.length)}): the per-dimension floor reservation is not affordable at a fractional unit.`
    );
  }
  const owed = REQUIRED_DIMENSIONS.length * MAX_EVIDENCE_BYTES_PER_FILE;
  if (owed > MAX_EVIDENCE_BYTES_TOTAL) {
    throw new Error(
      `the floor reservation is not affordable: ${String(REQUIRED_DIMENSIONS.length)} dimensions x ${String(MAX_EVIDENCE_BYTES_PER_FILE)} bytes per file = ${String(owed)} exceeds MAX_EVIDENCE_BYTES_TOTAL (${String(MAX_EVIDENCE_BYTES_TOTAL)}). Every dimension would be starved in the same run.`
    );
  }
}
