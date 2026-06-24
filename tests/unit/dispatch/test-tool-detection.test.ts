/**
 * Slice 2026-06-24-test-tool-detection-injection.
 *
 * Verifies the static `TEST_TOOL_DETECTION_BLOCK` constant + the pure
 * `formatTestToolDetection()` helper. Mirrors the style of
 * `tests/unit/dispatch/contract-store.test.ts`.
 *
 * 6 assertions:
 *  1. block is non-empty
 *  2. block contains heading `## Test Tool Detection (mandatory)`
 *  3. block contains literal `npx <runner>` (negative rule pin)
 *  4. block contains literal `peaks test --json` (positive hint pin)
 *  5. block byte length ≤ 800
 *  6. `formatTestToolDetection()` is pure + returns block byte-identically
 */
import { describe, expect, it } from 'vitest';
import {
  TEST_TOOL_DETECTION_BLOCK,
  formatTestToolDetection
} from '../../../src/services/dispatch/test-tool-detection.js';

describe('TEST_TOOL_DETECTION_BLOCK (slice 2026-06-24-test-tool-detection-injection)', () => {
  it('is non-empty', () => {
    expect(TEST_TOOL_DETECTION_BLOCK.length).toBeGreaterThan(0);
  });

  it('contains the heading `## Test Tool Detection (mandatory)`', () => {
    expect(TEST_TOOL_DETECTION_BLOCK).toContain('## Test Tool Detection (mandatory)');
  });

  it('pins the negative rule `npx <runner>`', () => {
    expect(TEST_TOOL_DETECTION_BLOCK).toContain('npx <runner>');
  });

  it('pins the positive hint `peaks test --json`', () => {
    expect(TEST_TOOL_DETECTION_BLOCK).toContain('peaks test --json');
  });

  it('is at most 800 bytes (predictable byte budget for PROMPT_LIMIT_BYTES accounting)', () => {
    expect(Buffer.byteLength(TEST_TOOL_DETECTION_BLOCK, 'utf8')).toBeLessThanOrEqual(800);
  });

  it('formatTestToolDetection() returns the block byte-identically and is pure', () => {
    const a = formatTestToolDetection();
    const b = formatTestToolDetection();
    // Same content every call (pure function).
    expect(a).toBe(b);
    // Byte-identical to the constant — no transformation, no trim, no template wrapping.
    expect(Buffer.byteLength(a, 'utf8')).toBe(Buffer.byteLength(TEST_TOOL_DETECTION_BLOCK, 'utf8'));
    expect(a).toBe(TEST_TOOL_DETECTION_BLOCK);
  });
});
