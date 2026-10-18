// tests/unit/rd/reviewer-dispatch-policy-decision-table.test.ts
//
// Pins the decision-table half of the v2.12.0 5→3 fanout collapse: the
// fanout request types are exactly the review request types the predicate
// accepts, the returned reviewer list is the canonical 3-way list with no
// deprecated slot, and the karpathy slot index agrees with that list.
// The predicate half lives in the sibling `reviewer-dispatch-policy.test.ts`.

import { describe, expect, it } from 'vitest';
import {
  RD_DEPRECATED_REVIEWERS,
  RD_FANOUT_REVIEWERS,
  RD_FANOUT_REQUEST_TYPES,
  RD_REVIEW_REQUEST_TYPES,
  isDeprecatedReviewer,
  isFanoutTriggerType,
  karpathySlotIndex,
  reviewerListFor,
  shouldDispatchKarpathy
} from '../../../src/services/rd/reviewer-dispatch-policy.js';

// v2.11.x's documented 5-way order. Kept here, not in src: the constant
// was deleted with the collapse, and this is the pin that says removing
// its two deprecated slots yields the canonical list.
const LEGACY_FIVE_WAY_ORDER = [
  'code-reviewer',
  'security-reviewer',
  'perf-baseline-reviewer',
  'qa-test-cases-writer',
  'karpathy-reviewer'
] as const;

describe('reviewer-dispatch-policy — decision table', () => {
  it('when every review request type is tested, should accept exactly the fanout request types', () => {
    // given: the 6-type review domain and the 3-type fanout tuple
    // when:  the predicate is applied to every domain member
    // then:  the accepted set is exactly RD_FANOUT_REQUEST_TYPES
    const accepted = RD_REVIEW_REQUEST_TYPES.filter((type) => isFanoutTriggerType(type));

    expect([...accepted]).toEqual([...RD_FANOUT_REQUEST_TYPES]);
    expect(RD_FANOUT_REQUEST_TYPES.length).toBe(3);
    for (const type of RD_REVIEW_REQUEST_TYPES) {
      const inTuple = (RD_FANOUT_REQUEST_TYPES as readonly string[]).includes(type);
      expect(isFanoutTriggerType(type)).toBe(inTuple);
    }
  });

  it('when the canonical fanout list is read, should name the three current reviewers only', () => {
    // given: the collapsed v2.12.0 fanout
    // when:  the ordered tuple is inspected
    // then:  it is the 3 current slots, with no deprecated slot
    expect([...RD_FANOUT_REVIEWERS]).toEqual([
      'code-reviewer',
      'qa-test-cases-writer',
      'karpathy-reviewer'
    ]);
    for (const role of RD_FANOUT_REVIEWERS) {
      expect(isDeprecatedReviewer(role)).toBe(false);
    }
  });

  it('when the two legacy slots are removed from the five-way order, should yield the canonical list', () => {
    // given: the v2.11.x 5-way order and the 2 deprecated reviewers
    // when:  the deprecated slots are filtered out
    // then:  the result is the canonical 3-way list, in the same order
    const remaining = LEGACY_FIVE_WAY_ORDER.filter((role) => !isDeprecatedReviewer(role));

    expect([...remaining]).toEqual([...RD_FANOUT_REVIEWERS]);
    expect(RD_DEPRECATED_REVIEWERS.length).toBe(2);
  });

  it('when a fanout type is passed to reviewerListFor, should return the fanout list minus deprecated reviewers', () => {
    // given: each request type that triggers the fanout
    // when:  the reviewer list is requested
    // then:  it equals RD_FANOUT_REVIEWERS with no deprecated reviewer present
    for (const type of RD_FANOUT_REQUEST_TYPES) {
      const expected = RD_FANOUT_REVIEWERS.filter((role) => !isDeprecatedReviewer(role));

      expect([...reviewerListFor(type)]).toEqual([...expected]);
      for (const role of reviewerListFor(type)) {
        expect(isDeprecatedReviewer(role)).toBe(false);
      }
    }
  });

  it('when a non-fanout type is passed to reviewerListFor, should return no reviewers', () => {
    // given: config / docs / chore, which skip the entire fanout
    // when:  the reviewer list is requested
    // then:  the list is empty, karpathy is skipped, and the predicate is false
    for (const type of RD_REVIEW_REQUEST_TYPES.filter((t) => !isFanoutTriggerType(t))) {
      expect(reviewerListFor(type)).toEqual([]);
      expect(shouldDispatchKarpathy(type)).toBe(false);
      expect(karpathySlotIndex(type)).toBe(-1);
    }
  });

  it('when karpathySlotIndex is asked for a fanout type, should index karpathy-reviewer in the returned list', () => {
    // given: each request type that triggers the fanout
    // when:  the slot index and the reviewer list are compared
    // then:  the index points at karpathy-reviewer, and the predicate agrees
    for (const type of RD_FANOUT_REQUEST_TYPES) {
      const list = reviewerListFor(type);
      const index = karpathySlotIndex(type);

      expect(shouldDispatchKarpathy(type)).toBe(true);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(list[index]).toBe('karpathy-reviewer');
    }
  });
});
