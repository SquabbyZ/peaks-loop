/**
 * Unit tests for GranularityDecider (peaks-solo/multipass W2 T6).
 *
 * Pure-function decider used by MultiPassOrchestrator to decide whether
 * a WorkUnit should be subdivided further. No LLM dependency.
 *
 * RED phase: file under test does not exist yet. Import will fail.
 * GREEN phase: shouldSubdivide() returns the expected DeciderResult.
 */

import { describe, it, expect } from 'vitest';
import {
  shouldSubdivide,
  DEFAULT_THRESHOLDS,
} from '../../../src/services/slice/granularity-decider.js';
import type { WorkUnit } from '../../../src/services/slice/slice-decompose-types.js';

/**
 * Build a WorkUnit stub with only the fields the decider actually reads.
 * Keeps the test fixtures minimal and focused on the contract.
 */
function makeWu(overrides: { id?: string; loc: number; files: readonly string[] }): WorkUnit {
  return {
    id: overrides.id ?? 'W1',
    label: 'stub',
    files: overrides.files,
    loc: overrides.loc,
    testsAdded: 0,
    filePath: overrides.files[0] ?? 'src/stub.ts',
    candidates: [],
  };
}

describe('GranularityDecider.shouldSubdivide', () => {
  it('returns false for a small WU well under threshold', () => {
    const wu = makeWu({ loc: 100, files: ['src/a.ts'] });
    const result = shouldSubdivide(wu);
    expect(result.subdivide).toBe(false);
    expect(result.reason).toMatch(/under threshold/);
  });

  it('returns true when loc exceeds maxLoc', () => {
    const wu = makeWu({ loc: 500, files: ['src/a.ts'] });
    const result = shouldSubdivide(wu);
    expect(result.subdivide).toBe(true);
    expect(result.reason).toMatch(/exceeds threshold/);
  });

  it('returns true when file count exceeds maxFiles', () => {
    const wu = makeWu({ loc: 100, files: ['a', 'b', 'c', 'd', 'e'] });
    const result = shouldSubdivide(wu);
    expect(result.subdivide).toBe(true);
    expect(result.reason).toMatch(/exceeds threshold/);
  });

  it("returns 'tie-break' when loc is within 20% of maxLoc", () => {
    // maxLoc=400, 80% = 320. loc=350 > 320 → tie-break.
    const wu = makeWu({ loc: 350, files: ['src/a.ts'] });
    const result = shouldSubdivide(wu);
    expect(result.subdivide).toBe('tie-break');
    expect(result.reason).toMatch(/within 20%/);
  });

  it("returns 'tie-break' when file count is within 20% of maxFiles", () => {
    // maxFiles=3, 80% = 2.4. files=3 > 2.4 → tie-break.
    const wu = makeWu({ loc: 100, files: ['a', 'b', 'c'] });
    const result = shouldSubdivide(wu);
    expect(result.subdivide).toBe('tie-break');
    expect(result.reason).toMatch(/within 20%/);
  });

  it('returns true when both loc and files exceed (multi-file large)', () => {
    const wu = makeWu({ loc: 600, files: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] });
    const result = shouldSubdivide(wu);
    expect(result.subdivide).toBe(true);
  });

  it('keeps the top threshold exclusive — loc=maxLoc alone lands in tie-break, not true', () => {
    // Mutation probe: guards against `>=` off-by-one in the exceed check.
    // At the exact top threshold (loc=400, files=1), locExceeded is false
    // (400 > 400 is false), so we must NOT return `true`. We DO land in
    // tie-break because loc=400 > 320 (the 80% borderline).
    const wu = makeWu({ loc: 400, files: ['src/a.ts'] });
    const result = shouldSubdivide(wu);
    expect(result.subdivide).not.toBe(true);
    expect(result.subdivide).toBe('tie-break');
  });

  it('returns false just under the borderline band (loc=320, files=2)', () => {
    // loc=320 == 80% of 400 (not strictly greater); files=2 < 80% of 3 (2.4).
    // Both borderline checks are false → subdivide: false.
    const wu = makeWu({ loc: 320, files: ['a', 'b'] });
    const result = shouldSubdivide(wu);
    expect(result.subdivide).toBe(false);
    expect(result.reason).toMatch(/under threshold/);
  });

  it('respects custom thresholds', () => {
    // With maxFiles=1, maxLoc=50: loc=60 alone exceeds.
    const overLoc = makeWu({ loc: 60, files: ['src/a.ts'] });
    expect(shouldSubdivide(overLoc, { maxFiles: 1, maxLoc: 50 }).subdivide).toBe(true);

    // Two files already exceeds maxFiles=1.
    const overFiles = makeWu({ loc: 10, files: ['a', 'b'] });
    expect(shouldSubdivide(overFiles, { maxFiles: 1, maxLoc: 50 }).subdivide).toBe(true);

    // loc=45 with maxLoc=50 → 45 > 50*0.8=40 → tie-break.
    const borderlineLoc = makeWu({ loc: 45, files: ['src/a.ts'] });
    expect(shouldSubdivide(borderlineLoc, { maxFiles: 1, maxLoc: 50 }).subdivide).toBe(
      'tie-break'
    );

    // With maxFiles=5, maxLoc=50: loc=10, files=1 → both well under → subdivide: false.
    const tiny = makeWu({ loc: 10, files: ['src/a.ts'] });
    expect(shouldSubdivide(tiny, { maxFiles: 5, maxLoc: 50 }).subdivide).toBe(false);
  });

  it('embeds the work-unit id in the reason string', () => {
    const wu = makeWu({ id: 'W42', loc: 500, files: ['src/a.ts'] });
    const result = shouldSubdivide(wu);
    expect(result.reason).toContain('W42');
  });

  it('exposes DEFAULT_THRESHOLDS = { maxFiles: 3, maxLoc: 400 }', () => {
    expect(DEFAULT_THRESHOLDS).toEqual({ maxFiles: 3, maxLoc: 400 });
  });
});