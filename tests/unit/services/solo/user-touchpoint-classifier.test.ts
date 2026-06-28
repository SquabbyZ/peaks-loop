/**
 * v2.15.0 follow-up — G4 tests: user touchpoint classifier.
 */
import { describe, it, expect } from 'vitest';
import {
  aiAutoDecidesGates,
  classifyAllGates,
  classifyGate,
  userMustReviewGates
} from '../../../../src/services/solo/user-touchpoint-classifier.js';

describe('classifyGate', () => {
  it('classifies step-1-mode-select as mode-selection (user must review)', () => {
    const c = classifyGate('step-1-mode-select');
    expect(c?.kind).toBe('mode-selection');
    expect(c?.userShouldReview).toBe('always');
    expect(c?.fullAutoCanProceed).toBe(false);
  });

  it('classifies phase-2-prd-confirm as business (user must review)', () => {
    const c = classifyGate('phase-2-prd-confirm');
    expect(c?.kind).toBe('business');
    expect(c?.userShouldReview).toBe('always');
  });

  it('classifies phase-3-swarm-gate-b as tech (AI auto-decides in full-auto)', () => {
    const c = classifyGate('phase-3-swarm-gate-b');
    expect(c?.kind).toBe('tech');
    expect(c?.userShouldReview).toBe('never');
    expect(c?.fullAutoCanProceed).toBe(true);
  });

  it('returns null for unknown step', () => {
    expect(classifyGate('nope')).toBeNull();
  });
});

describe('classifyAllGates / userMustReviewGates / aiAutoDecidesGates', () => {
  it('classifyAllGates returns 14 gates (one per Solo gate)', () => {
    const all = classifyAllGates();
    expect(all.length).toBe(14);
  });

  it('userMustReviewGates returns only gates the user must review', () => {
    const must = userMustReviewGates();
    expect(must.length).toBeGreaterThan(0);
    expect(must.every((g) => g.userShouldReview !== 'never')).toBe(true);
  });

  it('aiAutoDecidesGates returns only tech-classified gates', () => {
    const auto = aiAutoDecidesGates();
    expect(auto.length).toBeGreaterThan(0);
    expect(auto.every((g) => g.fullAutoCanProceed)).toBe(true);
  });

  it('all 14 gates are classified (no overlap between must-review and auto)', () => {
    const must = userMustReviewGates();
    const auto = aiAutoDecidesGates();
    // must-review includes 'always' + 'business-only'; auto = 'never'.
    // Their union covers all 14.
    const mustSet = new Set(must.map((g) => g.step));
    for (const a of auto) expect(mustSet.has(a.step)).toBe(false);
    const union = new Set([...mustSet, ...auto.map((g) => g.step)]);
    expect(union.size).toBe(14);
  });
});
