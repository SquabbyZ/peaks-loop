/**
 * Slice 2026-06-28-solo-mode-bypass-fix (defect #1).
 *
 * Pins the contract that `step-1-mode-select` (and the other
 * mode/context-selection steps) ALWAYS pause for AskUserQuestion,
 * regardless of mode. Previously the new-session flow auto-defaulted
 * `mode=full-auto` on the first tool call because `shouldAutoProceed`
 * fired on step-1 too — SKILL.md Step 1 mandates an AskUserQuestion
 * for new sessions.
 */

import { describe, expect, it } from 'vitest';
import { shouldPauseAtGate } from '../../../src/services/solo/mode-gate.js';

describe('mode-gate — slice 2026-06-28-solo-mode-bypass-fix', () => {
  describe('step-1-mode-select (defect #1 regression)', () => {
    it.each(['full-auto', 'assisted', 'swarm', 'strict'] as const)(
      'pauses for AskUserQuestion in mode=%s',
      (mode) => {
        const decision = shouldPauseAtGate({ mode, step: 'step-1-mode-select' });
        expect(decision.shouldPause).toBe(true);
        expect(decision.reason).toContain('step=step-1-mode-select');
        expect(decision.gateKind).toBe('mode-selection-itself');
      }
    );
  });

  describe('other mode/context-selection steps also hard-pause', () => {
    it.each([
      'step-0.5-openspec-opt-in',
      'step-0.7-resume-detection'
    ] as const)('step=%s pauses in full-auto', (step) => {
      const decision = shouldPauseAtGate({ mode: 'full-auto', step });
      expect(decision.shouldPause).toBe(true);
      expect(decision.gateKind).toBe('mode-selection-itself');
    });
  });

  describe('non-mode-selection steps still auto-proceed in full-auto/swarm', () => {
    it.each([
      'phase-2-prd-confirm',
      'phase-6-qa-gate-d',
      'step-n+1-final-review'
    ] as const)('step=%s auto-proceeds in mode=full-auto', (step) => {
      const decision = shouldPauseAtGate({ mode: 'full-auto', step });
      expect(decision.shouldPause).toBe(false);
      expect(decision.gateKind).toBe('mode-driven');
    });

    it.each([
      'phase-2-prd-confirm',
      'phase-6-qa-gate-d'
    ] as const)('step=%s auto-proceeds in mode=swarm', (step) => {
      const decision = shouldPauseAtGate({ mode: 'swarm', step });
      expect(decision.shouldPause).toBe(false);
      expect(decision.gateKind).toBe('mode-driven');
    });
  });

  describe('assisted/strict still pause by default for non-selection steps', () => {
    it.each(['assisted', 'strict'] as const)('mode=%s pauses step=phase-2-prd-confirm', (mode) => {
      const decision = shouldPauseAtGate({ mode, step: 'phase-2-prd-confirm' });
      expect(decision.shouldPause).toBe(true);
      expect(decision.gateKind).toBe('mode-driven');
    });
  });

  describe('hard-floor categories still take precedence', () => {
    it('irreversible-external-side-effect pauses full-auto at step-1', () => {
      const decision = shouldPauseAtGate({
        mode: 'full-auto',
        step: 'phase-3-swarm-gate-b',
        hardFloorCategory: 'irreversible-external-side-effect'
      });
      expect(decision.shouldPause).toBe(true);
      expect(decision.gateKind).toBe('hard-floor');
      expect(decision.hardFloorCategory).toBe('irreversible-external-side-effect');
    });
  });
});