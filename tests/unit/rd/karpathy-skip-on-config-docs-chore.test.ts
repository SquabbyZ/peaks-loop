/**
 * Slice 2026-06-24-efficiency-4p-bundle / G4 (P1.3) — karpathy-skip policy
 * Slice v2.12.0 Group B (Tier 4) — collapse 5-way → 3-way fanout.
 *
 * Locks the karpathy-reviewer skip policy (unchanged since G4):
 *
 *   (a) `config` → karpathy reviewer not dispatched (fanout skipped)
 *   (b) `docs`   → karpathy reviewer not dispatched
 *   (c) `chore`  → karpathy reviewer not dispatched
 *   (d) `feat`   → karpathy reviewer IS dispatched (in the 3-way fanout)
 *   (e) `bugfix` → karpathy reviewer IS dispatched (in the 3-way fanout)
 *   (f) `refactor` → karpathy reviewer IS dispatched (in the 3-way fanout)
 *
 * Plus supporting invariants (slice v2.12.0 Tier 4):
 *   - reviewerListFor is the canonical decision table
 *   - karpathy slot index returns -1 for skip types
 *   - RD_FANOUT_REVIEWERS enumerates exactly the **3** reviewer roles
 *     (was 5 in v2.11.x; security-reviewer + perf-baseline-reviewer
 *     moved to independent audit skills)
 *   - the karpathy-reviewer prompt text is unchanged (AC-4.5)
 *   - dispatch record count for config/docs/chore = 0
 *     (no karpathy record under .peaks/_sub_agents/<sid>/)
 *   - the fanout-trigger types return a 3-element list (was 5)
 *
 * Coverage target: new code branch ≥ 90%.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import {
  karpathySlotIndex,
  RD_FANOUT_REVIEWERS,
  RD_FANOUT_REQUEST_TYPES,
  RD_REVIEW_REQUEST_TYPES,
  reviewerListFor,
  shouldDispatchKarpathy,
  type RdReviewRequestType,
} from '../../../src/services/rd/reviewer-dispatch-policy.js';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, '..', '..', '..');
// `skills/peaks-rd/references/karpathy-reviewer-prompt.md` is a 2-line
// pointer file (peaks-cli 2.0 rules convention). The canonical content
// lives at `agents/karpathy-reviewer.md`. AC-4.5 pins the canonical
// content is unchanged — we assert against the canonical file.
const KARPATHY_PROMPT_PATH = join(
  REPO_ROOT,
  'agents',
  'karpathy-reviewer.md'
);

describe('AC-4.1 karpathy-reviewer is skipped for config/docs/chore', () => {
  // (a)
  test('type=config → karpathy reviewer not dispatched', () => {
    expect(shouldDispatchKarpathy('config')).toBe(false);
    expect(karpathySlotIndex('config')).toBe(-1);
    expect(reviewerListFor('config')).toEqual([]);
  });

  // (b)
  test('type=docs → karpathy reviewer not dispatched', () => {
    expect(shouldDispatchKarpathy('docs')).toBe(false);
    expect(karpathySlotIndex('docs')).toBe(-1);
    expect(reviewerListFor('docs')).toEqual([]);
  });

  // (c)
  test('type=chore → karpathy reviewer not dispatched', () => {
    expect(shouldDispatchKarpathy('chore')).toBe(false);
    expect(karpathySlotIndex('chore')).toBe(-1);
    expect(reviewerListFor('chore')).toEqual([]);
  });
});

describe('AC-4.2 karpathy-reviewer is dispatched for feat/bugfix/refactor', () => {
  // (d)
  test('type=feat → karpathy reviewer in dispatch list', () => {
    expect(shouldDispatchKarpathy('feat')).toBe(true);
    expect(karpathySlotIndex('feat')).toBeGreaterThanOrEqual(0);
    const list = reviewerListFor('feat');
    expect(list).toContain('karpathy-reviewer');
    expect(list).toContain('code-reviewer');
    expect(list).toContain('qa-test-cases-writer');
    // v2.12.0 Tier 4: security-reviewer / perf-baseline-reviewer
    // moved to independent audit skills (peaks-security-audit /
    // peaks-perf-audit) and are no longer in the RD fanout.
    expect(list).not.toContain('security-reviewer');
    expect(list).not.toContain('perf-baseline-reviewer');
  });

  // (e)
  test('type=bugfix → karpathy reviewer in dispatch list', () => {
    expect(shouldDispatchKarpathy('bugfix')).toBe(true);
    expect(karpathySlotIndex('bugfix')).toBeGreaterThanOrEqual(0);
    expect(reviewerListFor('bugfix')).toContain('karpathy-reviewer');
  });

  // (f)
  test('type=refactor → karpathy reviewer in dispatch list', () => {
    expect(shouldDispatchKarpathy('refactor')).toBe(true);
    expect(karpathySlotIndex('refactor')).toBeGreaterThanOrEqual(0);
    expect(reviewerListFor('refactor')).toContain('karpathy-reviewer');
  });
});

describe('AC-4 supporting invariants', () => {
  test('RD_FANOUT_REVIEWERS enumerates exactly the 3 reviewer roles (v2.12.0 collapse)', () => {
    expect(RD_FANOUT_REVIEWERS).toEqual([
      'code-reviewer',
      'qa-test-cases-writer',
      'karpathy-reviewer',
    ]);
  });

  test('RD_REVIEW_REQUEST_TYPES covers all 6 RD types (exhaustive)', () => {
    expect([...RD_REVIEW_REQUEST_TYPES].sort()).toEqual(
      ['bugfix', 'chore', 'config', 'docs', 'feat', 'refactor'].sort()
    );
  });

  test('RD_FANOUT_REQUEST_TYPES covers only the 3 fanout types', () => {
    expect([...RD_FANOUT_REQUEST_TYPES].sort()).toEqual(
      ['bugfix', 'feat', 'refactor'].sort()
    );
  });

  test('dispatch record count for config/docs/chore = 0 (no karpathy file)', () => {
    // AC-4.4: when the type does not trigger the fanout, no dispatch
    // record is written for any of the 3 reviewers (including
    // karpathy). The decision table is exhaustive: empty list ⇒ zero
    // dispatch records.
    const skipTypes: RdReviewRequestType[] = ['config', 'docs', 'chore'];
    for (const t of skipTypes) {
      expect(reviewerListFor(t).length).toBe(0);
    }
    // v2.12.0 Tier 4: feat/bugfix/refactor all return the 3-element
    // fanout. (Previously bugfix dropped perf-baseline-reviewer
    // conditionally; that conditional is gone now that the slot
    // moved to peaks-perf-audit.)
    expect(reviewerListFor('feat').length).toBe(3);
    expect(reviewerListFor('refactor').length).toBe(3);
    expect(reviewerListFor('bugfix').length).toBe(3);
  });

  // AC-4.5: karpathy reviewer prompt text is unchanged (4 guidelines
  // text + gate contract). This test pins the prompt file is still
  // on disk and references the canonical karpathy skill.
  test('karpathy-reviewer prompt file still exists and references the 4 guidelines', () => {
    expect(existsSync(KARPATHY_PROMPT_PATH)).toBe(true);
    const body = readFileSync(KARPATHY_PROMPT_PATH, 'utf8');
    // Must reference all 4 guideline names (case-insensitive substring).
    const lower = body.toLowerCase();
    expect(lower).toContain('think before coding');
    expect(lower).toContain('simplicity first');
    expect(lower).toContain('surgical changes');
    expect(lower).toContain('goal-driven execution');
  });
});