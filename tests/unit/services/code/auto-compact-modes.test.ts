/**
 * Slice 2026-07-28 (rid-027) — mode table unit tests.
 *
 * Pins the threshold table (standard 0.85/0.95 + partial 0.70/0.85)
 * and the helper contracts (`thresholdFor`, `isValidMode`,
 * `describeMode`, `isPartialModeEligible`). Failures here mean a
 * silent regression in the auto-compact decision pipeline.
 *
 * Slice 2026-07-30 (rid-027 + 1) — three-tier table:
 *   The implementation gained an `autoFire` tier (0.80 standard /
 *   0.65 partial) in Slice 2026-07-29-context-evaluation-accuracy
 *   Part 22. The orchestrator reads it via `thresholdFor(mode,
 *   'autoFire')` so the tier is part of the public contract. The
 *   structural-equality assertions below must therefore include the
 *   `autoFire` key, otherwise they fail with "extra property" noise.
 */
import { describe, expect, it } from 'vitest';
import {
  AUTO_COMPACT_THRESHOLDS,
  describeMode,
  isPartialModeEligible,
  isValidMode,
  thresholdFor
} from '../../../../src/services/code/auto-compact-modes.js';

describe('auto-compact-modes (rid-027)', () => {
  it('AUTO_COMPACT_THRESHOLDS has exactly the 2 expected modes with the correct numeric values', () => {
    expect(Object.keys(AUTO_COMPACT_THRESHOLDS).sort()).toEqual(['partial', 'standard']);
    expect(AUTO_COMPACT_THRESHOLDS.standard).toEqual({ autoFire: 0.80, preCompact: 0.85, redLine: 0.95 });
    expect(AUTO_COMPACT_THRESHOLDS.partial).toEqual({ autoFire: 0.65, preCompact: 0.70, redLine: 0.85 });
  });

  it('thresholdFor standard returns 0.85 / 0.95', () => {
    expect(thresholdFor('standard', 'preCompact')).toBe(0.85);
    expect(thresholdFor('standard', 'redLine')).toBe(0.95);
  });

  it('thresholdFor partial returns 0.70 / 0.85', () => {
    expect(thresholdFor('partial', 'preCompact')).toBe(0.70);
    expect(thresholdFor('partial', 'redLine')).toBe(0.85);
  });

  it('isValidMode accepts standard/partial and rejects unknown values', () => {
    expect(isValidMode('standard')).toBe(true);
    expect(isValidMode('partial')).toBe(true);
    expect(isValidMode('foo')).toBe(false);
    expect(isValidMode('aggressive')).toBe(false);
    expect(isValidMode('')).toBe(false);
  });

  it('describeMode mentions the threshold numbers for both modes', () => {
    expect(describeMode('standard')).toContain('0.85/0.95');
    expect(describeMode('partial')).toContain('0.70/0.85');
  });

  it('isPartialModeEligible fires at the partial preCompact threshold', () => {
    expect(isPartialModeEligible(0.69)).toBe(false);
    expect(isPartialModeEligible(0.70)).toBe(true);
    expect(isPartialModeEligible(0.85)).toBe(true);
  });
});
