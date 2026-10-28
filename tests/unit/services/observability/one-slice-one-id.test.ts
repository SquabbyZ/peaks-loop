// tests/unit/services/observability/one-slice-one-id.test.ts
//
// WHY THIS FILE EXISTS. A request id has TWO spellings: the logical id
// (`2026-10-28-nrm-one-slice-one-id`) and the numbered spelling the artifact
// writer stamps (`004-2026-10-28-nrm-one-slice-one-id`). The number is
// COSMETIC for identity — `NUMBERED_PREFIX_RE` is the repository's own
// statement that the two are ONE request — but a reader that groups by the raw
// string counts that request TWICE: two slices, two scores, one of them a false
// accusation. Measured on this repository's recorded history before the fix:
// 102 slice-transition events, 13 distinct raw rid strings, 9 distinct logical
// ids, and three transition moments recorded under both spellings.
//
// THE FIX IS AT THE READ SITES, NOT AT THE WRITER. Each read site consults
// `sliceIdentity(sliceRid).logical` before it groups. This file pins all five
// so a later reader cannot restore the raw-string grouping in one of them and
// leave the others correct.
//
// REFUSED IS NOT UNATTEMPTED, AND THE STATE IS READ FROM THE EVENTS. A slice
// whose check refused before its pass is `refused`; one that never ran is
// `unattempted`. When the refusals and the pass were recorded under DIFFERENT
// spellings, raw grouping splits them so the refusal becomes invisible and the
// false accusation reads `unattempted`. Grouped logically, the state is decided
// by WHAT HAPPENED — the refusal's position relative to the pass — and not by
// which bucket it landed in.
//
// Dimensions:
//   - behavior:    the five read sites collapsing two spellings to one id
//   - render:      the shapes a caller reads back (rollup, record, row key)
//   - integration: the events read from a real metrics file on disk
//   - a11y:        OMITTED — every module under test returns a structure

import { afterEach, describe, expect, it } from 'vitest';

import { aggregateSlices } from '~/src/services/observability/aggregation.js';
import { canonicalArtifact } from '~/src/services/observability/hotspot-shared.js';
import { computeNearMiss } from '~/src/services/observability/near-miss.js';
import { countDifferences } from '~/src/services/observability/near-miss-difference.js';
import { computeSliceRepairMetrics } from '~/src/services/observability/repair-cycle-metric.js';
import { declareDimensions } from '../../_setup/4dim-template.js';
import { cleanupRoots, seedSession } from './near-miss-fixture.js';

declareDimensions(
  'tests/unit/services/observability/one-slice-one-id.test.ts',
  ['behavior', 'render', 'integration'],
  [{ dim: 'a11y', reason: 'every module under test returns a structure; none renders a surface' }]
);

/** The logical spelling: the request id with no number prefix. */
const BARE = '2026-10-28-nrm-one-slice-one-id';
/** The numbered spelling of the SAME request: what the artifact writer stamps. */
const NUMBERED = `004-${BARE}`;

afterEach(() => {
  cleanupRoots();
});

/** One slice's transition attempt, under the given spelling of the rid. */
function attempt(rid: string, to: string, prereqOk: boolean): Record<string, unknown> {
  return {
    category: 'slice-transition',
    sliceRid: rid,
    detail: { artifactRole: 'rd', to, prereqOk, missingCount: prereqOk ? 0 : 3 }
  };
}

/**
 * One slice, recorded under BOTH spellings: four refusals at `qa-handoff`
 * written with the numbered id, then the successful pass written with the bare
 * one. Grouped by the raw string this is two slices and neither is a near-miss;
 * grouped by the logical id it is one slice whose key REFUSED.
 */
function straddlingSlice(): readonly Record<string, unknown>[] {
  return [
    attempt(NUMBERED, 'implemented', true),
    attempt(NUMBERED, 'qa-handoff', false),
    attempt(NUMBERED, 'qa-handoff', false),
    attempt(NUMBERED, 'qa-handoff', false),
    attempt(NUMBERED, 'qa-handoff', false),
    attempt(BARE, 'verdict-issued', true)
  ];
}

describe('Scenario: behavior — two spellings of one request are ONE slice', () => {
  it('when a slice recorded both spellings, should count it once in the denominator', () => {
    // given: one slice whose events carry both spellings of its rid
    // when: the near-miss metric is computed over the session
    // then: the slice is in the denominator ONCE, not twice
    const report = computeNearMiss(seedSession(straddlingSlice()));

    expect(report.passedSliceCount).toBe(1);
  });

  it('when the refusals and the pass were recorded under different spellings, should read the key as refused', () => {
    // given: the refusals carry the numbered id and the pass carries the bare one
    // when: the near-miss metric is computed over the session
    // then: the key is `refused` with all four refusals counted — the state is
    //       read from WHAT HAPPENED, not from which bucket it landed in
    const report = computeNearMiss(seedSession(straddlingSlice()));

    expect(report.nearMissSliceCount).toBe(1);
    const record = report.records[0];
    expect(record?.sliceRid).toBe(BARE);
    expect(record?.reasons).toContain('prereq-skipped');
    expect(record?.unsatisfiedKeys).toEqual([
      { key: 'rd -> qa-handoff', state: 'refused', refusalCount: 4 }
    ]);
  });

  it('when a key refused only after the pass, should still read it as unattempted', () => {
    // given: the pass was recorded first and the refusal came after it, both
    //        under the same spelling — the state must not become `refused`
    //        merely because the slice now has a refusal on the books
    // when: the near-miss metric is computed over the session
    // then: the key is `unattempted` — it had not run AT the pass moment
    const report = computeNearMiss(
      seedSession([
        attempt(NUMBERED, 'implemented', true),
        attempt(NUMBERED, 'verdict-issued', true),
        attempt(NUMBERED, 'qa-handoff', false)
      ])
    );

    expect(report.records[0]?.unsatisfiedKeys).toEqual([
      { key: 'rd -> qa-handoff', state: 'unattempted', refusalCount: 1 }
    ]);
  });

  it('when a slice straddles both spellings, should key the repair-cycle metric once', () => {
    // given: one slice recorded under both spellings
    // when: the repair-cycle metric is computed over the session
    // then: the map holds ONE row, under the logical id
    const metrics = computeSliceRepairMetrics(seedSession(straddlingSlice()));

    expect([...metrics.keys()]).toEqual([BARE]);
  });

  it('when a slice straddles both spellings, should key the difference count by the logical id', () => {
    // given: one successful slice whose pass moment carries the numbered id
    //        while the rollup carries the logical one
    // when: the differences are counted between the rollups and the events
    // then: the slice's pass moment IS found, so it is not counted as a
    //       success that reached no verdict
    const events = seedSession([
      attempt(NUMBERED, 'implemented', true),
      attempt(NUMBERED, 'verdict-issued', true)
    ]);
    const rollups = aggregateSlices(events);

    const differences = countDifferences(events, rollups, new Map());

    expect(rollups).toHaveLength(1);
    expect(differences.successWithoutPassMoment).toBe(0);
  });
});

describe('Scenario: render — the rollup names the slice by ONE id', () => {
  it('when a slice recorded both spellings, should roll it up under the logical id', () => {
    // given: one slice whose transitions carry both spellings
    // when: the slices are rolled up
    // then: there is ONE rollup, keyed by the logical id, and every transition
    //       it accumulated is on it
    const rollups = aggregateSlices(
      seedSession([
        attempt(NUMBERED, 'implemented', true),
        attempt(BARE, 'qa-handoff', true),
        attempt(NUMBERED, 'verdict-issued', true)
      ])
    );

    expect(rollups).toHaveLength(1);
    expect(rollups[0]?.sliceRid).toBe(BARE);
    expect(rollups[0]?.transitions).toBe(3);
    expect(rollups[0]?.success).toBe(true);
  });
});

describe('Scenario: integration — the artifact canonicaliser collapses the two spellings', () => {
  it('when the rid is bare and the recorded path is numbered, should return the template', () => {
    // given: an artifact recorded under its numbered name, read back with the
    //        bare rid — the shape a retro-attributed row arrives in
    // when: the path is canonicalised
    // then: it is the template, so the forward and retro rows share ONE row
    expect(canonicalArtifact(`rd/code-review-${NUMBERED}.md`, BARE)).toBe(
      'rd/code-review-<rid>.md'
    );
  });

  it('when the rid is numbered and the recorded path is bare, should return the template', () => {
    // given: the mirror image of the case above
    // when: the path is canonicalised
    // then: it is the template too — the collapse is symmetric in the spelling
    expect(canonicalArtifact(`rd/code-review-${BARE}.md`, NUMBERED)).toBe(
      'rd/code-review-<rid>.md'
    );
  });

  it('when the path names a DIFFERENT request, should leave it alone', () => {
    // given: an artifact of another request, which must not be folded into this one
    // when: the path is canonicalised against this slice's rid
    // then: the path is returned unchanged — collapsing two distinct artifacts
    //       would be the same defect in the other direction
    expect(canonicalArtifact('rd/code-review-2026-10-27-other-slice.md', BARE)).toBe(
      'rd/code-review-2026-10-27-other-slice.md'
    );
  });

  it('when the path carries an extra segment, should not match the template', () => {
    // given: a path with a directory between the template head and the id
    // when: it is canonicalised
    // then: it is returned unchanged — the carried id is not this request's
    expect(canonicalArtifact(`rd/code-review/sub/${BARE}.md`, BARE)).toBe(
      `rd/code-review/sub/${BARE}.md`
    );
  });
});
