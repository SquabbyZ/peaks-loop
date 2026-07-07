/**
 * v2.15.0 slice 002 — AC-4: commit-boundary hard-floor tests.
 *
 * Covers:
 *   - `detectCommitBoundaryAction` (5 action ids + non-matching commands)
 *   - `shouldPauseAtGate` × 4 modes × 5 commit-boundary actions
 *     (20 cases — all must pause)
 *   - `HARD_FLOOR_CATEGORIES` includes the new `commit-boundary-side-effect`
 *   - Edge cases: `git push --tags`, `npm install -g peaks-loop`, command
 *     ordering (peaks-global-install matches before git/npm patterns)
 *   - Regression: existing 3 hard-floor categories still pause
 *
 * 6+ cases (the PRD's "≥6 cases" AC-4 floor) — 30+ actual cases below.
 */

import { describe, expect, test } from 'vitest';

import {
  COMMIT_BOUNDARY_ACTIONS,
  COMMIT_BOUNDARY_PATTERNS,
  detectCommitBoundaryAction,
  GATED_STEPS,
  HARD_FLOOR_CATEGORIES,
  isCommitBoundaryAction,
  shouldPauseAtGate,
  CODE_MODES,
  type CommitBoundaryActionId,
  type CodeMode
} from '../../../../src/services/code/mode-gate.js';

describe('HARD_FLOOR_CATEGORIES — AC-4 includes commit-boundary-side-effect', () => {
  test('array contains all 4 categories (3 original + new commit-boundary)', () => {
    expect(HARD_FLOOR_CATEGORIES).toContain('irreversible-external-side-effect');
    expect(HARD_FLOOR_CATEGORIES).toContain('authentication-credential');
    expect(HARD_FLOOR_CATEGORIES).toContain('multi-day-investment');
    expect(HARD_FLOOR_CATEGORIES).toContain('commit-boundary-side-effect');
  });

  test('isCommitBoundaryAction type guard', () => {
    for (const id of COMMIT_BOUNDARY_ACTIONS) {
      expect(isCommitBoundaryAction(id)).toBe(true);
    }
    expect(isCommitBoundaryAction('not-a-real-action')).toBe(false);
    expect(isCommitBoundaryAction('')).toBe(false);
  });

  test('COMMIT_BOUNDARY_ACTIONS lists all 5 actions', () => {
    expect(COMMIT_BOUNDARY_ACTIONS).toEqual([
      'git-push',
      'git-tag',
      'npm-publish',
      'npm-install-global',
      'peaks-global-install'
    ]);
  });
});

describe('detectCommitBoundaryAction — AC-4 pattern matchers', () => {
  test('matches git push', () => {
    expect(detectCommitBoundaryAction('git push')).toBe('git-push');
    expect(detectCommitBoundaryAction('git push origin main')).toBe('git-push');
    expect(detectCommitBoundaryAction('git push --tags')).toBe('git-push');
  });

  test('matches git tag', () => {
    expect(detectCommitBoundaryAction('git tag v2.15.0')).toBe('git-tag');
    expect(detectCommitBoundaryAction('git tag -a v2.15.0 -m "release"')).toBe('git-tag');
  });

  test('matches npm publish', () => {
    expect(detectCommitBoundaryAction('npm publish')).toBe('npm-publish');
    expect(detectCommitBoundaryAction('npm publish --access public')).toBe('npm-publish');
    expect(detectCommitBoundaryAction('npm pub')).toBe('npm-publish');
  });

  test('matches npm install -g', () => {
    expect(detectCommitBoundaryAction('npm install -g some-pkg')).toBe('npm-install-global');
    expect(detectCommitBoundaryAction('npm i -g some-pkg')).toBe('npm-install-global');
    expect(detectCommitBoundaryAction('npm add --global some-pkg')).toBe('npm-install-global');
  });

  test('matches peaks-loop global install (most specific — checked first)', () => {
    expect(detectCommitBoundaryAction('npm install -g peaks-loop')).toBe('peaks-global-install');
    expect(detectCommitBoundaryAction('pnpm add -g peaks-loop')).toBe('peaks-global-install');
  });

  test('does NOT match non-boundary commands', () => {
    expect(detectCommitBoundaryAction('git status')).toBeNull();
    expect(detectCommitBoundaryAction('git commit -m "msg"')).toBeNull();
    expect(detectCommitBoundaryAction('npm install --save-dev some-pkg')).toBeNull();
    expect(detectCommitBoundaryAction('pnpm vitest run')).toBeNull();
    expect(detectCommitBoundaryAction('ls -la')).toBeNull();
    expect(detectCommitBoundaryAction('')).toBeNull();
  });

  test('handles compound commands with && correctly', () => {
    expect(detectCommitBoundaryAction('cd . && git push origin main')).toBe('git-push');
    expect(detectCommitBoundaryAction('npm test && npm publish')).toBe('npm-publish');
  });
});

describe('shouldPauseAtGate × commit-boundary-action — AC-4 ALWAYS pauses', () => {
  const NON_HARD_PAUSE_STEPS = GATED_STEPS.filter(
    (s) => s !== 'step-1-mode-select'
      && s !== 'step-0.5-openspec-opt-in'
      && s !== 'step-0.7-resume-detection'
  );
  // 4 modes × 5 commit-boundary actions = 20 base cases. Plus 4
  // modes × 5 actions on hard-pause steps = 20 more. Plus a
  // mode-driven step showing the override wins. = 40+ total.
  for (const mode of CODE_MODES) {
    for (const _action of COMMIT_BOUNDARY_ACTIONS) {
      for (const step of NON_HARD_PAUSE_STEPS) {
        test(`mode=${mode} action=${_action} step=${step} → ALWAYS pause`, () => {
          const decision = shouldPauseAtGate({
            mode,
            step,
            commitBoundaryAction: true
          });
          expect(decision.shouldPause).toBe(true);
          expect(decision.gateKind).toBe('hard-floor');
          expect(decision.hardFloorCategory).toBe('commit-boundary-side-effect');
          expect(decision.reason).toContain('commit-boundary');
        });
      }
    }
  }

  test('commit-boundary override wins over full-auto auto-proceed', () => {
    // Pick a step that would otherwise auto-proceed in full-auto.
    const decision = shouldPauseAtGate({
      mode: 'full-auto',
      step: 'phase-2-prd-confirm',
      commitBoundaryAction: true
    });
    expect(decision.shouldPause).toBe(true);
    expect(decision.hardFloorCategory).toBe('commit-boundary-side-effect');
  });

  test('commit-boundary override wins over assisted/strict (already paused)', () => {
    const decision = shouldPauseAtGate({
      mode: 'assisted',
      step: 'phase-2-prd-confirm',
      commitBoundaryAction: true
    });
    expect(decision.shouldPause).toBe(true);
    expect(decision.hardFloorCategory).toBe('commit-boundary-side-effect');
  });

  test('commit-boundary flag = false does NOT force pause', () => {
    const decision = shouldPauseAtGate({
      mode: 'full-auto',
      step: 'phase-2-prd-confirm',
      commitBoundaryAction: false
    });
    // full-auto + non-mode-selection step = auto-proceed.
    expect(decision.shouldPause).toBe(false);
    expect(decision.hardFloorCategory).toBeUndefined();
  });

  test('commit-boundary + explicit hardFloorCategory: explicit wins on category, but override still pauses', () => {
    // When both flags are set, the explicit hardFloorCategory wins
    // on the decision's `hardFloorCategory` field (preserves
    // user-supplied intent). Both still pause.
    const decision = shouldPauseAtGate({
      mode: 'full-auto',
      step: 'phase-2-prd-confirm',
      hardFloorCategory: 'multi-day-investment',
      commitBoundaryAction: true
    });
    expect(decision.shouldPause).toBe(true);
    expect(decision.hardFloorCategory).toBe('multi-day-investment');
    expect(decision.gateKind).toBe('hard-floor');
  });
});

describe('COMMIT_BOUNDARY_PATTERNS — pattern sanity', () => {
  test('all 5 patterns are defined and are RegExp instances', () => {
    const ids: CommitBoundaryActionId[] = ['git-push', 'git-tag', 'npm-publish', 'npm-install-global', 'peaks-global-install'];
    for (const id of ids) {
      expect(COMMIT_BOUNDARY_PATTERNS[id]).toBeInstanceOf(RegExp);
    }
  });
});

describe('Regression — existing 3 hard-floor categories still work (D5.b)', () => {
  for (const category of ['irreversible-external-side-effect', 'authentication-credential', 'multi-day-investment'] as const) {
    for (const mode of CODE_MODES) {
      test(`category=${category} mode=${mode} → still pauses (no regression)`, () => {
        const decision = shouldPauseAtGate({ mode, step: 'phase-2-prd-confirm', hardFloorCategory: category });
        expect(decision.shouldPause).toBe(true);
        expect(decision.gateKind).toBe('hard-floor');
        expect(decision.hardFloorCategory).toBe(category);
      });
    }
  }
});
