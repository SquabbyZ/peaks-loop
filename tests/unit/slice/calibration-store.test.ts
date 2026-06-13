import { describe, expect, it } from 'vitest';
import { calibrate } from '../../../src/services/slice/calibration-store.js';

describe('calibration-store', () => {
  describe('input validation', () => {
    it('rejects negative complexitySum', () => {
      expect(() => calibrate(-1, 0, 0, 0)).toThrow(RangeError);
    });

    it('rejects non-integer testCount', () => {
      expect(() => calibrate(0, 1.5, 0, 0)).toThrow(RangeError);
    });

    it('rejects negative testCount', () => {
      expect(() => calibrate(0, -1, 0, 0)).toThrow(RangeError);
    });

    it('rejects negative locSum', () => {
      expect(() => calibrate(0, 0, -1, 0)).toThrow(RangeError);
    });

    it('rejects negative sampleSize', () => {
      expect(() => calibrate(0, 0, 0, -1)).toThrow(RangeError);
    });

    it('rejects NaN inputs', () => {
      expect(() => calibrate(NaN, 0, 0, 0)).toThrow(RangeError);
    });

    it('accepts all zeros', () => {
      const result = calibrate(0, 0, 0, 0);
      expect(result.minutesP50).toBe(0);
      expect(result.minutesP90).toBe(0);
      expect(result.confidence).toBe('low');
    });
  });

  describe('estimation formula', () => {
    it('applies the v1 heuristic: 0.25 min/LoC + 0.5 min/test + 0.1 min/complexity', () => {
      // 0.25 * 100 + 0.5 * 4 + 0.1 * 10 = 25 + 2 + 1 = 28
      const result = calibrate(10, 4, 100, 0);
      expect(result.minutesP50).toBe(28);
      expect(result.minutesP90).toBe(44.8); // 28 * 1.6
    });

    it('rounds to one decimal place', () => {
      // 0.25 * 33 = 8.25 -> 8.3
      const result = calibrate(0, 0, 33, 0);
      expect(result.minutesP50).toBe(8.3);
    });

    it('echoes inputs in the result', () => {
      const result = calibrate(7, 3, 50, 0);
      expect(result.complexitySum).toBe(7);
      expect(result.testCount).toBe(3);
      expect(result.locSum).toBe(50);
    });
  });

  describe('confidence bands', () => {
    it('returns "low" when sampleSize === 0', () => {
      const result = calibrate(0, 0, 100, 0);
      expect(result.confidence).toBe('low');
      expect(result.rationale).toContain('no historical sample');
    });

    it('returns "medium" when 1 <= sampleSize < 5', () => {
      for (const n of [1, 2, 3, 4]) {
        const result = calibrate(0, 0, 100, n);
        expect(result.confidence).toBe('medium');
        expect(result.rationale).toContain(`${n} historical sample`);
      }
    });

    it('returns "high" when sampleSize >= 5', () => {
      for (const n of [5, 10, 100]) {
        const result = calibrate(0, 0, 100, n);
        expect(result.confidence).toBe('high');
        expect(result.rationale).toContain('v1.1 will switch to percentile');
      }
    });
  });

  describe('edge cases', () => {
    it('handles large LoC (10,000 lines)', () => {
      const result = calibrate(0, 0, 10000, 0);
      expect(result.minutesP50).toBe(2500);
      expect(result.minutesP90).toBe(4000);
    });

    it('handles large testCount (200 tests)', () => {
      const result = calibrate(0, 200, 0, 0);
      expect(result.minutesP50).toBe(100);
    });

    it('handles large complexitySum (1,000 units)', () => {
      const result = calibrate(1000, 0, 0, 0);
      expect(result.minutesP50).toBe(100);
    });
  });
});
