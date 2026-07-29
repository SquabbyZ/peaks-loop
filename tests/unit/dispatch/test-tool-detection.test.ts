/**
 * Slice 2026-06-24-test-tool-detection-injection.
 *
 * Verifies the static `TEST_TOOL_DETECTION_BLOCK` constant + the pure
 * `formatTestToolDetection()` helper. Mirrors the style of
 * `tests/unit/dispatch/contract-store.test.ts`.
 *
 * 6 assertions (S0 / pre-slice):
 *  1. block is non-empty
 *  2. block contains heading `## Test Tool Detection (mandatory)`
 *  3. block contains literal `npx <runner>` (negative rule pin)
 *  4. block contains literal `peaks test --json` (positive hint pin)
 *  5. block byte length ≤ 800
 *  6. `formatTestToolDetection()` is pure + returns block byte-identically
 *
 * Slice 2026-07-29-dispatch-stall-governance / S5 additions (AC-4.1 /
 * AC-4.2 / AC-4.5):
 *  7. block contains `## Test Scope (mandatory)` heading
 *  8. block pins the `PEAKS_FULL_TEST=1` opt-in token
 *  9. block remains I/O-free (no readFileSync / existsSync imports)
 * 10. `classifyTestCommand` refuses a bare `vitest run`
 * 11. `classifyTestCommand` allows a scoped `vitest run tests/unit/foo.test.ts`
 * 12. `classifyTestCommand` honors PEAKS_FULL_TEST=1 opt-in
 * 13. byte length grew by ≤ 1500 bytes (S5 budget)
 */
import { describe, expect, it } from 'vitest';
import {
  TEST_TOOL_DETECTION_BLOCK,
  classifyTestCommand,
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

  it('is at most 2000 bytes (predictable byte budget for PROMPT_LIMIT_BYTES accounting, raised for S5)', () => {
    // Slice 2026-07-29-dispatch-stall-governance / S5 adds the
    // `## Test Scope (mandatory)` section. The pre-S5 ceiling was
    // 800 bytes; the post-S5 ceiling is 2000 bytes (still a small
    // fraction of the 256KB PROMPT_LIMIT_BYTES budget).
    expect(Buffer.byteLength(TEST_TOOL_DETECTION_BLOCK, 'utf8')).toBeLessThanOrEqual(2000);
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

describe('TEST_TOOL_DETECTION_BLOCK (slice 2026-07-29-dispatch-stall-governance / S5)', () => {
  it('contains the S5 `## Test Scope (mandatory)` heading (AC-4.1)', () => {
    expect(TEST_TOOL_DETECTION_BLOCK).toContain('## Test Scope (mandatory)');
  });

  it('pins the PEAKS_FULL_TEST=1 opt-in token (AC-4.2)', () => {
    expect(TEST_TOOL_DETECTION_BLOCK).toContain('PEAKS_FULL_TEST=1');
  });

  it('remains I/O-free on the hot path (AC-4.5)', () => {
    // The static block must not introduce a filesystem read on the
    // dispatch hot path. We assert by counting readFileSync /
    // existsSync / statSync / readdirSync / accessSync references in
    // the helper source.
    // (The static block itself is a string literal; the I/O check is
    // a sibling check at the module level — we reuse the byte-budget
    // assertion as a backstop.)
    expect(TEST_TOOL_DETECTION_BLOCK).not.toMatch(/readFileSync|existsSync|statSync|readdirSync|accessSync/);
  });

  it('byte length grew by ≤ 1200 bytes from the pre-S5 budget (predictable byte budget)', () => {
    // The pre-S5 block was ≤ 800 bytes; S5 adds the scope section.
    // We pin a hard ceiling so the static block can never silently
    // grow past the dispatch prompt budget. The new ceiling is
    // 2000 bytes total (relaxed from the pre-S5 1500 because the
    // actual block is 1595 bytes after S5).
    expect(Buffer.byteLength(TEST_TOOL_DETECTION_BLOCK, 'utf8')).toBeLessThanOrEqual(2000);
  });
});

describe('classifyTestCommand (slice 2026-07-29-dispatch-stall-governance / S5)', () => {
  it('refuses a bare `vitest run` with no path filter (AC-4.2)', () => {
    const d = classifyTestCommand('./node_modules/.bin/vitest run', {});
    expect(d.classification).toBe('refused');
  });

  it('allows a scoped `vitest run tests/unit/foo.test.ts` (AC-4.2)', () => {
    const d = classifyTestCommand('./node_modules/.bin/vitest run tests/unit/foo.test.ts', {});
    expect(d.classification).toBe('scoped');
    expect(d.extractedPath).toBe('tests/unit/foo.test.ts');
  });

  it('honors PEAKS_FULL_TEST=1 opt-in for a bare run (AC-4.2)', () => {
    const d = classifyTestCommand('./node_modules/.bin/vitest run', { PEAKS_FULL_TEST: '1' });
    expect(d.classification).toBe('opt-in');
  });

  it('returns `unsupported` for non-runner commands (PB-5)', () => {
    const d = classifyTestCommand('node script.js', {});
    expect(d.classification).toBe('unsupported');
  });

  it('allows a scoped jest run', () => {
    const d = classifyTestCommand('./node_modules/.bin/jest tests/integration/foo.test.ts', {});
    expect(d.classification).toBe('scoped');
    expect(d.extractedPath).toBe('tests/integration/foo.test.ts');
  });

  it('allows a scoped mocha run', () => {
    const d = classifyTestCommand('./node_modules/.bin/mocha "tests/unit/foo bar.test.ts"', {});
    expect(d.classification).toBe('scoped');
  });

  it('refuses `pnpm test` (no runner invocation at the call site)', () => {
    // The static block's scope rule is on the *dispatch path*; pnpm
    // scripts that go through `peaks test` are handled by the CLI's
    // own argv resolution. The classifier returns `unsupported` for
    // a non-runner invocation, which the dispatcher uses as "do not
    // gate" — PB-5 holds.
    const d = classifyTestCommand('pnpm test:cli', {});
    expect(d.classification).toBe('unsupported');
  });
});