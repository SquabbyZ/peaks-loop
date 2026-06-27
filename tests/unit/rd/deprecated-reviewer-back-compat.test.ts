/**
 * Slice v2.12.0 Group B (Tier 4) — deprecated-reviewer back-compat test.
 *
 * Pinned invariants for the 1-minor-release back-compat window:
 *   - `security-reviewer` and `perf-baseline-reviewer` are no longer in
 *     `RD_FANOUT_REVIEWERS` (the 5→3 collapse).
 *   - They ARE enumerated in `RD_DEPRECATED_REVIEWERS` so callers can
 *     detect legacy dispatch records or on-disk rd/{security-review,
 *     perf-baseline}.md artifacts and route to the new audit skill
 *     instead of failing the gate.
 *   - `isDeprecatedReviewer(name)` is the canonical predicate.
 *   - The new audit skill names (`peaks-security-audit` /
 *     `peaks-perf-audit`) are NOT in the fanout list (they live in
 *     their own skills, dispatched via the new CLI commands rather
 *     than via `peaks sub-agent dispatch`).
 *   - Cross-checks: every element of RD_FANOUT_REVIEWERS is NOT in
 *     RD_DEPRECATED_REVIEWERS, and vice versa.
 *
 * Coverage target: ≥ 90% of the new branch surface.
 */
import { describe, expect, test } from 'vitest';

import {
  isDeprecatedReviewer,
  karpathySlotIndex,
  RD_DEPRECATED_REVIEWERS,
  RD_FANOUT_REVIEWERS,
  reviewerListFor,
} from '../../../src/services/rd/reviewer-dispatch-policy.js';

describe('v2.12.0 Tier 4 — fanout collapsed from 5 to 3 reviewers', () => {
  test('RD_FANOUT_REVIEWERS has exactly 3 elements', () => {
    expect(RD_FANOUT_REVIEWERS).toHaveLength(3);
  });

  test('RD_FANOUT_REVIEWERS contains code-reviewer, qa-test-cases-writer, karpathy-reviewer', () => {
    expect([...RD_FANOUT_REVIEWERS].sort()).toEqual(
      ['code-reviewer', 'karpathy-reviewer', 'qa-test-cases-writer'].sort()
    );
  });

  test('security-reviewer / perf-baseline-reviewer are NOT in RD_FANOUT_REVIEWERS', () => {
    expect(RD_FANOUT_REVIEWERS).not.toContain('security-reviewer');
    expect(RD_FANOUT_REVIEWERS).not.toContain('perf-baseline-reviewer');
  });

  test('feat/bugfix/refactor reviewer lists no longer include the 2 removed slots', () => {
    for (const t of ['feat', 'bugfix', 'refactor'] as const) {
      const list = reviewerListFor(t);
      expect(list).not.toContain('security-reviewer');
      expect(list).not.toContain('perf-baseline-reviewer');
    }
  });

  test('karpathy reviewer slot index is still in-range after the collapse', () => {
    expect(karpathySlotIndex('feat')).toBe(RD_FANOUT_REVIEWERS.indexOf('karpathy-reviewer'));
    expect(karpathySlotIndex('bugfix')).toBeGreaterThanOrEqual(0);
    expect(karpathySlotIndex('refactor')).toBeGreaterThanOrEqual(0);
  });
});

describe('v2.12.0 Tier 4 — RD_DEPRECATED_REVIEWERS back-compat', () => {
  test('RD_DEPRECATED_REVIEWERS enumerates exactly the 2 removed reviewer roles', () => {
    expect([...RD_DEPRECATED_REVIEWERS].sort()).toEqual(
      ['perf-baseline-reviewer', 'security-reviewer'].sort()
    );
  });

  test('isDeprecatedReviewer returns true for the 2 removed names', () => {
    expect(isDeprecatedReviewer('security-reviewer')).toBe(true);
    expect(isDeprecatedReviewer('perf-baseline-reviewer')).toBe(true);
  });

  test('isDeprecatedReviewer returns false for the 3 current names', () => {
    for (const name of RD_FANOUT_REVIEWERS) {
      expect(isDeprecatedReviewer(name)).toBe(false);
    }
  });

  test('isDeprecatedReviewer returns false for unrelated / unknown role names', () => {
    expect(isDeprecatedReviewer('code-reviewer-2')).toBe(false);
    expect(isDeprecatedReviewer('auditor')).toBe(false);
    expect(isDeprecatedReviewer('')).toBe(false);
    expect(isDeprecatedReviewer('peaks-security-audit')).toBe(false);
    expect(isDeprecatedReviewer('peaks-perf-audit')).toBe(false);
  });

  test('cross-check: RD_FANOUT_REVIEWERS and RD_DEPRECATED_REVIEWERS are disjoint', () => {
    const fanout = new Set<string>(RD_FANOUT_REVIEWERS);
    const deprecated = new Set<string>(RD_DEPRECATED_REVIEWERS);
    for (const name of fanout) {
      expect(deprecated.has(name)).toBe(false);
    }
    for (const name of deprecated) {
      expect(fanout.has(name)).toBe(false);
    }
  });

  test('the new audit skill names live in their own skills, not the fanout', () => {
    // peaks-security-audit / peaks-perf-audit are dispatched via
    // `peaks security-audit` / `peaks perf-audit` CLI commands
    // (slice v2.12.0 Tier 2-3). They must NOT be sub-agent role names
    // inside the RD fanout — the fanout is LLM-internal, the audit
    // skills are user-invoked.
    expect(RD_FANOUT_REVIEWERS).not.toContain('peaks-security-audit');
    expect(RD_FANOUT_REVIEWERS).not.toContain('peaks-perf-audit');
  });
});

describe('v2.12.0 Tier 4 — 1-minor-release on-disk back-compat', () => {
  test('legacy dispatch records for security-reviewer are recognised as deprecated', () => {
    // Realistic on-disk path: `.peaks/_sub_agents/<sid>/dispatch/security-reviewer-<rid>.json`
    // The dispatcher code path is expected to call isDeprecatedReviewer
    // on the role name extracted from the dispatch record filename and
    // reroute to `peaks security-audit` rather than fail. This test
    // pins the predicate that drives that reroute.
    const role = 'security-reviewer';
    if (!isDeprecatedReviewer(role)) {
      throw new Error('expected security-reviewer to be recognised as deprecated');
    }
    // Same for the perf slot.
    expect(isDeprecatedReviewer('perf-baseline-reviewer')).toBe(true);
  });
});