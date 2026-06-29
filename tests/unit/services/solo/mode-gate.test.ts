/**
 * v2.11.0 Group F (Tier 9) — D5 mode-gate unit tests.
 *
 * Covers:
 *   - `shouldAutoProceed` × 4 modes (auto-proceed for full-auto/swarm only)
 *   - `shouldPauseAtGate` × 4 modes × 14 GATED_STEPS (56 cases)
 *   - 3 hard-floor categories always pause (D5.b)
 *   - `formatAutoProceedLogLine` shape (auto-proceed vs auto-pause)
 *   - `isSoloMode` / `isHardFloorCategory` type guards
 */

import { describe, expect, test } from 'vitest';

import {
  GATED_STEPS,
  HARD_FLOOR_CATEGORIES,
  SOLO_MODES,
  formatAutoProceedLogLine,
  isHardFloorCategory,
  isSoloMode,
  shouldAutoProceed,
  shouldPauseAtGate,
  type GatedStepId,
  type HardFloorCategory,
  type SoloMode
} from '../../../../src/services/solo/mode-gate.js';

const NON_AUTO_MODES: readonly SoloMode[] = ['assisted', 'strict'];
const AUTO_MODES: readonly SoloMode[] = ['full-auto', 'swarm'];

describe('isSoloMode / isHardFloorCategory', () => {
  test('isSoloMode accepts all 4 declared modes', () => {
    for (const m of SOLO_MODES) {
      expect(isSoloMode(m)).toBe(true);
    }
  });

  test('isSoloMode rejects unknown strings', () => {
    expect(isSoloMode('semi-auto')).toBe(false);
    expect(isSoloMode('')).toBe(false);
  });

  test('isHardFloorCategory accepts all 3 declared categories', () => {
    for (const c of HARD_FLOOR_CATEGORIES) {
      expect(isHardFloorCategory(c)).toBe(true);
    }
  });

  test('isHardFloorCategory rejects unknown strings', () => {
    expect(isHardFloorCategory('not-a-real-category')).toBe(false);
    expect(isHardFloorCategory('')).toBe(false);
  });
});

describe('shouldAutoProceed — D5.a', () => {
  test('full-auto and swarm auto-proceed', () => {
    for (const m of AUTO_MODES) {
      expect(shouldAutoProceed(m)).toBe(true);
    }
  });

  test('assisted and strict do NOT auto-proceed', () => {
    for (const m of NON_AUTO_MODES) {
      expect(shouldAutoProceed(m)).toBe(false);
    }
  });
});

describe('shouldPauseAtGate — 4 modes × 14 GATED_STEPS (56 cases)', () => {
  // Slice 2026-06-28-solo-mode-bypass-fix (defect #1): hard-pause
  // steps (mode/context selection) ALWAYS pause regardless of mode.
  // v2.18.4 slice 002-fix-first-run-step-gates: added
  // `step-0.55-1x-upgrade` to the hard-pause set (1.x → 2.0
  // upgrade is an irreversible external side effect and must always
  // pause, even in full-auto).
  const HARD_PAUSE_STEP_SET: ReadonlySet<GatedStepId> = new Set<GatedStepId>([
    'step-1-mode-select',
    'step-0.5-openspec-opt-in',
    'step-0.7-resume-detection',
    'step-0.55-1x-upgrade'
  ]);
  for (const mode of SOLO_MODES) {
    for (const step of GATED_STEPS) {
      test(`mode=${mode} step=${step} → expected pause`, () => {
        const decision = shouldPauseAtGate({ mode, step });
        if (HARD_PAUSE_STEP_SET.has(step)) {
          // Mode-selection steps always pause, regardless of mode.
          expect(decision.shouldPause).toBe(true);
          expect(decision.gateKind).toBe('mode-selection-itself');
        } else if (AUTO_MODES.includes(mode)) {
          expect(decision.shouldPause).toBe(false);
          expect(decision.gateKind).toBe('mode-driven');
        } else {
          expect(decision.shouldPause).toBe(true);
          expect(decision.gateKind).toBe('mode-driven');
        }
        expect(decision.hardFloorCategory).toBeUndefined();
      });
    }
  }
});

describe('shouldPauseAtGate — hard-floor always wins (D5.b)', () => {
  for (const category of HARD_FLOOR_CATEGORIES) {
    for (const mode of SOLO_MODES) {
      test(`mode=${mode} + hard-floor=${category} → ALWAYS pause`, () => {
        const decision = shouldPauseAtGate({ mode, step: 'phase-2-prd-confirm', hardFloorCategory: category });
        expect(decision.shouldPause).toBe(true);
        expect(decision.hardFloorCategory).toBe(category);
        expect(decision.gateKind).toBe('hard-floor');
        expect(decision.reason).toContain('hard-floor');
      });
    }
  }
});

describe('shouldPauseAtGate — invalid hard-floor is ignored (caller should validate)', () => {
  test('unknown hard-floor string is treated as no hard-floor (mode wins)', () => {
    // Use a non-hard-pause step so the test isolates the hard-floor
    // path (otherwise step-1-mode-select's hard-pause would win).
    const decision = shouldPauseAtGate({
      mode: 'full-auto',
      step: 'phase-2-prd-confirm',
      hardFloorCategory: 'unknown-category' as HardFloorCategory
    });
    expect(decision.shouldPause).toBe(false);
    expect(decision.hardFloorCategory).toBeUndefined();
    expect(decision.gateKind).toBe('mode-driven');
  });
});

describe('formatAutoProceedLogLine — shape', () => {
  test('auto-proceed line includes mode and step', () => {
    const line = formatAutoProceedLogLine({
      mode: 'full-auto',
      step: 'step-0.7-resume-detection' as GatedStepId,
      recommendedOption: 'auto-resume'
    });
    expect(line).toContain('auto-proceed');
    expect(line).toContain('full-auto');
    expect(line).toContain('step-0.7-resume-detection');
    expect(line).toContain('auto-resume');
  });

  test('hard-floor line includes the hard-floor annotation', () => {
    const line = formatAutoProceedLogLine({
      mode: 'full-auto',
      step: 'phase-2-prd-confirm' as GatedStepId,
      recommendedOption: 'confirmed-by-user',
      hardFloorCategory: 'multi-day-investment'
    });
    expect(line).toContain('auto-pause');
    expect(line).toContain('hard-floor:multi-day-investment');
    expect(line).toContain('full-auto');
  });
});
