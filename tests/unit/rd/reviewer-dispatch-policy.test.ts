// tests/unit/rd/reviewer-dispatch-policy.test.ts
//
// AC-1 of slice 2026-09-17-4-0-51-cleanup: isDeprecatedReviewer +
// RD_DEPRECATED_REVIEWERS have NO dedicated unit tests (they are only
// hit transitively by other fixtures). This file is the behavior-framed
// coverage pinned to the S2 acceptance criteria.
//
// Tests are framed as BEHAVIOR (not "coverage"), each case names what
// the predicate is for, not what line it covers.

import { describe, expect, it } from 'vitest';
import {
  RD_DEPRECATED_REVIEWERS,
  isDeprecatedReviewer,
  type RdDeprecatedReviewer
} from '../../../src/services/rd/reviewer-dispatch-policy.js';

describe('isDeprecatedReviewer — AC-1 coverage', () => {
  it('exposes a canonical 2-name deprecated list', () => {
    // Behavior: the source array is the SOLE source of truth for which
    // reviewers are deprecated. Adding/removing a name here is the
    // operational contract; this test pins it so silent mutation breaks.
    expect([...RD_DEPRECATED_REVIEWERS]).toEqual(['security-reviewer', 'perf-baseline-reviewer']);
  });

  it('accepts every name listed in RD_DEPRECATED_REVIEWERS', () => {
    // Behavior: the predicate is a true membership check.
    for (const name of RD_DEPRECATED_REVIEWERS) {
      expect(isDeprecatedReviewer(name)).toBe(true);
    }
  });

  it('rejects a known non-deprecated name', () => {
    // Behavior: not every reviewer name is deprecated.
    expect(isDeprecatedReviewer('code-reviewer')).toBe(false);
    expect(isDeprecatedReviewer('karpathy-reviewer')).toBe(false);
    expect(isDeprecatedReviewer('qa-test-cases-writer')).toBe(false);
  });

  it('returns false for an empty string', () => {
    // Behavior: defensive — empty name is not in the list.
    expect(isDeprecatedReviewer('')).toBe(false);
  });

  it('returns false for a name that differs only in case', () => {
    // Behavior: the predicate is case-sensitive; future code that
    // calls it must not assume lower-casing upstream.
    expect(isDeprecatedReviewer('Security-Reviewer')).toBe(false);
    expect(isDeprecatedReviewer('SECURITY-REVIEWER')).toBe(false);
  });

  it('narrows the type when true', () => {
    // Behavior: the return type IS `name is RdDeprecatedReviewer`, so
    // TypeScript narrows correctly. This test pins the narrowing by
    // using the narrowed type after a truthy call.
    const candidate: string = RD_DEPRECATED_REVIEWERS[0];
    if (isDeprecatedReviewer(candidate)) {
      const narrowed: RdDeprecatedReviewer = candidate;
      expect(narrowed).toBe(candidate);
    } else {
      throw new Error('expected first array element to be a deprecated reviewer');
    }
  });
});
