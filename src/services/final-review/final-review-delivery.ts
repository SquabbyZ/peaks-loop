// src/services/final-review/final-review-delivery.ts
//
// H2 — the delivery-reachability analysis and its envelope gate. The
// judgement itself stays delegated to isDelivered, which remains in the
// service module (guard C pins it there) — this module asks it.
// Hoisted verbatim from final-review-service.ts (C wave 7 file-size
// split).

import { isDelivered } from './final-review-service.js';
import {
  MAX_EVIDENCE_BYTES_PER_FILE,
  REQUIRED_DIMENSIONS
} from './final-review-evidence-budget.js';
import type { CollectedEvidence } from './final-review-evidence-sources.js';
import type { DimensionEvidence, DimensionKind } from './final-review-types.js';

/**
 * H2 — the reason a dimension is red PERMANENTLY, as opposed to merely unfed on
 * this run. Reported per source, so the arithmetic is checkable by the reader.
 */
export interface UndeliverableDimensionEvidence {
  readonly dimension: DimensionKind;
  readonly sources: readonly {
    readonly key: string;
    readonly relativePath: string;
    readonly totalBytes: number;
  }[];
}

/**
 * Can this source EVER be delivered, whatever the budget?
 *
 * `whole` is the only rule with a structural ceiling. Its test is
 * `includedBytes === totalBytes`, and the allocator can only ever inline
 * `min(bytes, MAX_EVIDENCE_BYTES_PER_FILE)` — so a `whole`-rule source LARGER
 * than the per-file cap can never be delivered: not on this run, not on any
 * run, not with any budget, because the budget is not what cuts it. Raising
 * `MAX_EVIDENCE_BYTES_TOTAL` changes nothing either, since the per-file cap is
 * derived from it and the reservation spends all of it.
 *
 * (`conclusion` sources are deliberately NOT covered. A marker missing from the
 * first cap-sized bytes of an oversize artifact might simply live past the cut,
 * so "undeliverable forever" is not a claim this module can make about them —
 * and an over-claiming check is the failure mode this file keeps closing.)
 */
function isStructurallyUndeliverable(item: CollectedEvidence): boolean {
  if (item.source.delivery.kind !== 'whole') return false;
  return item.totalBytes > MAX_EVIDENCE_BYTES_PER_FILE;
}

/**
 * H2 — every required dimension whose verdict is locked to `inconclusive` by
 * BYTE ARITHMETIC rather than by the reviewer's judgement.
 *
 * The defect this exists for: `qa/test-reports/<rid>.md` measured 9,492 bytes
 * on this repo's own run and is the ONLY source on disk for `problem-resolution`
 * and `no-new-bugs` (the other sources that support them are absent), against a
 * per-file cap of 10,240 — a 748-byte margin on a file that is REWRITTEN every
 * round and only grows. The moment it crosses 10,240 both dimensions go
 * permanently red, and NOTHING said so: `assertFloorReservationAffordable()`
 * only checks the constant-level relation (`4 x cap <= total`), never whether
 * any actual source fits the cap it must live under, so the red handoff read as
 * "the reviewer was unsure" instead of "no evidence can ever reach the
 * reviewer". A gate that is always red and never explains itself is noise, and
 * this is the same "always red" harm the floor reservation was built to remove
 * — one layer down.
 *
 * The conditions, all three of which must hold, are chosen so the report cannot
 * be noise:
 *   1. NOTHING on disk can back the dimension (no `isDelivered`), and
 *   2. there IS something on disk to deliver (a source that was never written
 *      is not a delivery failure — same reasoning as the scope-contract gate's
 *      `missing` exemption: a run with no QA phase has no report to lose), and
 *   3. EVERY one of those on-disk sources is structurally undeliverable — a
 *      single source that merely did not fit TODAY (budget-exhausted `omitted`)
 *      is a different, self-correcting state and is left to the allocator.
 *
 * The report is consumed by the prompt (stated to the reviewer), by the
 * envelope (a marker on each dimension's summary) and by `needsAttention`
 * (which also clears `allPass`) — see `enforceDeliveryReachability` and
 * `renderDeliveryReachabilityStatus`. It is a LOUD STATEMENT, not a silent
 * downgrade, and it is deliberately not a throw: a crash would destroy the
 * evidence for the three dimensions that ARE deliverable, and the honest fact
 * here is per-dimension, so it is reported per-dimension.
 */
export function undeliverableDimensions(
  collected: readonly CollectedEvidence[]
): readonly UndeliverableDimensionEvidence[] {
  const report: UndeliverableDimensionEvidence[] = [];
  for (const dimension of REQUIRED_DIMENSIONS) {
    const supporting = collected.filter((item) => item.source.supports.includes(dimension));
    if (supporting.some((item) => isDelivered(item, dimension))) continue;
    const onDisk = supporting.filter((item) => item.totalBytes > 0);
    if (onDisk.length === 0) continue;
    if (!onDisk.every(isStructurallyUndeliverable)) continue;
    report.push({
      dimension,
      sources: onDisk.map((item) => ({
        key: item.source.key,
        relativePath: item.relativePath,
        totalBytes: item.totalBytes
      }))
    });
  }
  return report;
}

/**
 * H2 — the envelope half of the same fact. A dimension named by
 * `undeliverableDimensions()` cannot be `pass` (no source on disk can carry its
 * conclusion), so this is not where the verdict is decided — that is
 * `enforceEvidenceBackedVerdicts`, and this gate re-applies it so the property
 * does not depend on that gate's order. What this adds is the REASON: the
 * dimension's own summary says it is red by construction. Because the verdict
 * it leaves behind is non-`pass`, the dimension also reaches `needsAttention`
 * (and clears `allPass`) through the ordinary verdict route, which is the field
 * the CLI envelope prints — so the human is told WHY instead of being left to
 * read a permanent red as the reviewer's uncertainty.
 */
export function enforceDeliveryReachability(
  dimensions: readonly DimensionEvidence[],
  report: readonly UndeliverableDimensionEvidence[]
): readonly DimensionEvidence[] {
  if (report.length === 0) return dimensions;
  const byDimension = new Map(report.map((entry) => [entry.dimension, entry]));
  return dimensions.map((dimension) => {
    const entry = byDimension.get(dimension.dimension);
    if (entry === undefined) return dimension;
    // The ENVELOPE is not byte-capped, so it names the path as well as the
    // size: the path is what a human has to act on to fix it.
    const detail = entry.sources
      .map((item) => `${item.key} at ${item.relativePath} (${String(item.totalBytes)} bytes)`)
      .join(', ');
    const marker = `[delivery-reachability: ${
      dimension.verdict === 'pass'
        ? 'verdict downgraded from "pass" to "inconclusive"'
        : `gate ran; verdict "${dimension.verdict}" is already non-"pass" and is left unchanged`
    } — EVERY source on disk that supports "${dimension.dimension}" (${detail}) is larger than the per-file delivery cap of ${String(MAX_EVIDENCE_BYTES_PER_FILE)} bytes, and a source is inlined WHOLE or not at all, so no evidence for this dimension can ever reach the reviewer. The dimension is red by byte arithmetic, not by the reviewer's judgement, and it is listed in needsAttention for that reason.]`;
    const annotated: DimensionEvidence = {
      ...dimension,
      summary: `${dimension.summary} ${marker}`
    };
    if (dimension.verdict !== 'pass') return annotated;
    return { ...annotated, verdict: 'inconclusive', confidence: 'low' };
  });
}
