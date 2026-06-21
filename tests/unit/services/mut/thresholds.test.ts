import { describe, it, expect } from 'vitest';
import {
  DEFAULT_THRESHOLDS,
  evaluateThresholds,
} from '../../../../src/services/mut/thresholds.js';

describe('evaluateThresholds', () => {
  it('passes when both metrics within bounds', () => {
    const result = evaluateThresholds(DEFAULT_THRESHOLDS, 0.85, 0.03);
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('fails when kill rate below minimum', () => {
    const result = evaluateThresholds(DEFAULT_THRESHOLDS, 0.70, 0.03);
    expect(result.passed).toBe(false);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ kind: 'mutationKillRateMin' }),
    );
  });

  it('fails when weak rate above maximum', () => {
    const result = evaluateThresholds(DEFAULT_THRESHOLDS, 0.85, 0.10);
    expect(result.passed).toBe(false);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ kind: 'weakAssertionRateMax' }),
    );
  });

  it('reports both violations when both fail', () => {
    const result = evaluateThresholds(DEFAULT_THRESHOLDS, 0.50, 0.20);
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(2);
  });
});