/**
 * v2.18.4 slice 002-fix-first-run-step-gates — AC-1 + AC-2 + AC-3.
 *
 * Regression / behaviour tests for the two first-run step gates that
 * were silently broken in full-auto:
 *
 *   - Bug 1 (P0): step-0.55-1x-upgrade silently skipped in full-auto
 *     (mode-gate.ts: added to HARD_PAUSE_STEPS).
 *   - Bug 2 (P1): step-1-mode-select CLI chicken-and-egg (CLI:
 *     --mode is now optional, defaults to 'full-auto').
 *
 * Coverage (per dispatch AC-4):
 *   - full-auto + step-0.55-1x-upgrade → pause (NEW behaviour)
 *   - assisted + step-0.55-1x-upgrade → pause (regression guard)
 *   - strict  + step-0.55-1x-upgrade → pause
 *   - swarm   + step-0.55-1x-upgrade → pause
 *   - step-1-mode-select WITHOUT --mode → pause, no error (NEW)
 *   - step-1-mode-select WITH --mode full-auto → pause, same reason
 *   - step-0.5-openspec-opt-in unchanged (regression guard)
 *   - step-0.7-resume-detection unchanged (regression guard)
 */

import { describe, expect, test } from 'vitest';

import {
  shouldPauseAtGate,
  type CodeMode
} from '../../../../src/services/code/mode-gate.js';

const ALL_MODES: readonly CodeMode[] = ['full-auto', 'assisted', 'swarm', 'strict'];

describe('Bug 1 — step-0.55-1x-upgrade always pauses (NEW behaviour)', () => {
  for (const mode of ALL_MODES) {
    test(`mode=${mode} + step=step-0.55-1x-upgrade → ALWAYS pause`, () => {
      const decision = shouldPauseAtGate({ mode, step: 'step-0.55-1x-upgrade' });
      expect(decision.shouldPause).toBe(true);
      // The pause is gated by the HARD_PAUSE_STEPS set, so the
      // gateKind is 'mode-selection-itself' (mode/context lock-in),
      // not 'hard-floor'. The 1.x → 2.0 upgrade is treated like the
      // other context-selection steps because it decides whether the
      // user commits to a migration at all.
      expect(decision.gateKind).toBe('mode-selection-itself');
      expect(decision.reason).toContain('step-0.55-1x-upgrade');
    });
  }

  test('hard-floor override on step-0.55-1x-upgrade still wins (priority order preserved)', () => {
    const decision = shouldPauseAtGate({
      mode: 'full-auto',
      step: 'step-0.55-1x-upgrade',
      hardFloorCategory: 'irreversible-external-side-effect'
    });
    expect(decision.shouldPause).toBe(true);
    // hardFloorCategory wins on the gateKind because it is checked
    // BEFORE the HARD_PAUSE_STEPS short-circuit.
    expect(decision.gateKind).toBe('hard-floor');
    expect(decision.hardFloorCategory).toBe('irreversible-external-side-effect');
  });

  test('commit-boundary on step-0.55-1x-upgrade still wins (priority order preserved)', () => {
    const decision = shouldPauseAtGate({
      mode: 'full-auto',
      step: 'step-0.55-1x-upgrade',
      commitBoundaryAction: true
    });
    expect(decision.shouldPause).toBe(true);
    expect(decision.gateKind).toBe('hard-floor');
    expect(decision.hardFloorCategory).toBe('commit-boundary-side-effect');
  });
});

describe('Bug 2 — step-1-mode-select WITHOUT --mode defaults to full-auto, still pauses', () => {
  // The CLI layer resolves `opts.mode ?? 'full-auto'` before calling
  // shouldPauseAtGate. The service-layer function itself still
  // requires a mode, so we test the resolved path here.
  test('default full-auto + step-1-mode-select → pause, gateKind=mode-selection-itself', () => {
    const decision = shouldPauseAtGate({
      mode: 'full-auto', // the resolved default when --mode is omitted
      step: 'step-1-mode-select'
    });
    expect(decision.shouldPause).toBe(true);
    expect(decision.gateKind).toBe('mode-selection-itself');
    expect(decision.reason).toContain('step-1-mode-select');
  });

  test('explicit --mode full-auto + step-1-mode-select → pause with identical reason (no behaviour change)', () => {
    const decision = shouldPauseAtGate({
      mode: 'full-auto',
      step: 'step-1-mode-select'
    });
    // Same verdict as the implicit-default case (Bug 2 is purely a
    // CLI ergonomics fix — the gate logic is unchanged).
    expect(decision.shouldPause).toBe(true);
    expect(decision.gateKind).toBe('mode-selection-itself');
  });

  test('explicit --mode assisted + step-1-mode-select → pause (mode-driven path also pauses)', () => {
    const decision = shouldPauseAtGate({
      mode: 'assisted',
      step: 'step-1-mode-select'
    });
    expect(decision.shouldPause).toBe(true);
    // HARD_PAUSE_STEPS check runs BEFORE shouldAutoProceed, so the
    // gateKind is mode-selection-itself (not mode-driven).
    expect(decision.gateKind).toBe('mode-selection-itself');
  });
});

describe('Regression guards — unchanged behaviour for the other 2 hard-pause steps', () => {
  for (const mode of ALL_MODES) {
    test(`mode=${mode} + step=step-0.5-openspec-opt-in → pause, mode-selection-itself`, () => {
      const decision = shouldPauseAtGate({ mode, step: 'step-0.5-openspec-opt-in' });
      expect(decision.shouldPause).toBe(true);
      expect(decision.gateKind).toBe('mode-selection-itself');
    });

    test(`mode=${mode} + step=step-0.7-resume-detection → pause, mode-selection-itself`, () => {
      const decision = shouldPauseAtGate({ mode, step: 'step-0.7-resume-detection' });
      expect(decision.shouldPause).toBe(true);
      expect(decision.gateKind).toBe('mode-selection-itself');
    });
  }
});

describe('Cross-check — full-auto + non-hard-pause steps still auto-proceed', () => {
  // After the fix, full-auto + non-hard-pause steps must continue to
  // auto-proceed (regression guard for D5.a). Picks steps that are
  // NOT in HARD_PAUSE_STEPS and are NOT in the user-touchpoint-
  // classifier's commit-floor set.
  test('full-auto + phase-2-prd-confirm (no hard-floor) → auto-proceed', () => {
    const decision = shouldPauseAtGate({ mode: 'full-auto', step: 'phase-2-prd-confirm' });
    expect(decision.shouldPause).toBe(false);
    expect(decision.gateKind).toBe('mode-driven');
  });

  test('swarm + phase-6-qa-gate-d (no hard-floor) → auto-proceed', () => {
    const decision = shouldPauseAtGate({ mode: 'swarm', step: 'phase-6-qa-gate-d' });
    expect(decision.shouldPause).toBe(false);
    expect(decision.gateKind).toBe('mode-driven');
  });

  test('assisted + phase-2-prd-confirm (no hard-floor) → pause (mode-driven)', () => {
    const decision = shouldPauseAtGate({ mode: 'assisted', step: 'phase-2-prd-confirm' });
    expect(decision.shouldPause).toBe(true);
    expect(decision.gateKind).toBe('mode-driven');
  });
});