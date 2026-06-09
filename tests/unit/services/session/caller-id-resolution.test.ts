/**
 * Slice 020 — caller-id-resolution.test.ts.
 *
 * Covers A8 (caller-id resolution unit tests) and A5 (PLATFORM_FALLBACKS
 * table has exactly one entry). D1, D2, D4, D5 from the freeze-in contract
 * are exercised here; M1-M5 shim is exercised in
 * `synthetic-caller-id-collision.test.ts` and
 * `sub-agent-caller-inheritance.test.ts`.
 *
 * See `.peaks/_runtime/2026-06-09-session-8bfe7d/prd/source/caller-id-contract.md`
 * for the freeze-in contract and
 * `.peaks/_runtime/2026-06-09-session-8bfe7d/qa/test-cases/002-020-2026-06-09-caller-keyed-session-binding.md`
 * for the test-case catalog.
 */

import { describe, expect, test } from 'vitest';
import { resolveCallerId, CallerIdError } from '../../../../src/services/session/resolve-caller-id.js';
import { PLATFORM_FALLBACKS } from '../../../../src/services/session/platform-fallbacks.js';
import { CALLER_ID_REGEX } from '../../../../src/services/session/caller-id-types.js';

describe('A5 — PLATFORM_FALLBACKS table', () => {
  test('has exactly one entry today (Claude Code)', () => {
    expect(PLATFORM_FALLBACKS.length).toBe(1);
    expect(PLATFORM_FALLBACKS[0]?.envVar).toBe('CLAUDE_CODE_SESSION_ID');
    expect(PLATFORM_FALLBACKS[0]?.addedIn).toBe('1.3.7');
  });

  test('is a ReadonlyArray — adding entries requires a contract bump', () => {
    // A5 contract: each new entry requires a contract doc bump
    // (the QA test fails otherwise). This test pins the table to
    // exactly one entry; bumping the contract to add Cursor / Windsurf
    // requires updating this test alongside.
    expect(PLATFORM_FALLBACKS).toHaveLength(1);
  });
});

describe('D1 — callerId character set (strict whitelist)', () => {
  test('accepts ASCII letters, digits, dot, underscore, hyphen', () => {
    expect(CALLER_ID_REGEX.test('foo')).toBe(true);
    expect(CALLER_ID_REGEX.test('foo-bar')).toBe(true);
    expect(CALLER_ID_REGEX.test('foo_bar')).toBe(true);
    expect(CALLER_ID_REGEX.test('foo.bar')).toBe(true);
    expect(CALLER_ID_REGEX.test('a')).toBe(true);
    expect(CALLER_ID_REGEX.test('123')).toBe(true);
    expect(CALLER_ID_REGEX.test('a-b_c.d')).toBe(true);
  });

  test('rejects path separators (Windows backslash, Unix slash)', () => {
    expect(CALLER_ID_REGEX.test('foo/bar')).toBe(false);
    expect(CALLER_ID_REGEX.test('foo\\bar')).toBe(false);
    expect(CALLER_ID_REGEX.test('..\\bar')).toBe(false);
    expect(CALLER_ID_REGEX.test('../bar')).toBe(false);
  });

  test('rejects whitespace, NUL, and control characters', () => {
    expect(CALLER_ID_REGEX.test('foo bar')).toBe(false);
    expect(CALLER_ID_REGEX.test('foo\tbar')).toBe(false);
    expect(CALLER_ID_REGEX.test('foo\nbar')).toBe(false);
    expect(CALLER_ID_REGEX.test('foo\0bar')).toBe(false);
  });

  test('rejects empty string and over-long values', () => {
    expect(CALLER_ID_REGEX.test('')).toBe(false);
    expect(CALLER_ID_REGEX.test('a'.repeat(201))).toBe(false);
  });

  test('accepts exactly 200 characters', () => {
    expect(CALLER_ID_REGEX.test('a'.repeat(200))).toBe(true);
  });
});

describe('D2 — empty / unset callerId → reject (exit 64)', () => {
  test('throws CallerIdError (EX_USAGE) when nothing is set', () => {
    expect(() => resolveCallerId({ env: {} })).toThrow(CallerIdError);
    try {
      resolveCallerId({ env: {} });
    } catch (error) {
      expect(error).toBeInstanceOf(CallerIdError);
      const e = error as CallerIdError;
      expect(e.code).toBe('EX_USAGE');
      expect(e.source).toBe('none');
    }
  });

  test('error message tells the user what to do', () => {
    try {
      resolveCallerId({ env: {} });
      expect.fail('expected CallerIdError');
    } catch (error) {
      const e = error as CallerIdError;
      expect(e.message).toMatch(/No caller id available/);
      expect(e.message).toMatch(/PEAKS_CALLER_ID/);
      expect(e.message).toMatch(/--caller-id/);
    }
  });
});

describe('D4 — priority (flag beats env beats platform fallback beats reject)', () => {
  test('flag wins over env', () => {
    const id = resolveCallerId({
      flagValue: 'flag-wins',
      envOverride: 'env-loses',
      env: { CLAUDE_CODE_SESSION_ID: 'fallback-loses' }
    });
    expect(id).toBe('flag-wins');
  });

  test('env wins over platform fallback', () => {
    const id = resolveCallerId({
      envOverride: 'env-wins',
      env: { CLAUDE_CODE_SESSION_ID: 'fallback-loses' }
    });
    expect(id).toBe('env-wins');
  });

  test('platform fallback wins when no flag and no env', () => {
    const id = resolveCallerId({
      env: { CLAUDE_CODE_SESSION_ID: 'fallback-wins' }
    });
    expect(id).toBe('fallback-wins');
  });

  test('rejects (D2) when nothing is set', () => {
    expect(() => resolveCallerId({ env: {} })).toThrow(CallerIdError);
  });

  test('D4 priority: only one source wins, no merge', () => {
    // With all three set, the flag wins. There is no "combine"
    // semantics — exactly one source wins per D4.
    const id = resolveCallerId({
      flagValue: 'flag-only',
      envOverride: 'env-only',
      env: { CLAUDE_CODE_SESSION_ID: 'fallback-only' }
    });
    expect(id).toBe('flag-only');
  });
});

describe('D5 — parse failure (invalid chars / too long) → reject (exit 65)', () => {
  test('rejects flag value with path separator (exit 65, EX_DATAERR)', () => {
    try {
      resolveCallerId({ flagValue: 'foo/bar' });
      expect.fail('expected CallerIdError');
    } catch (error) {
      expect(error).toBeInstanceOf(CallerIdError);
      const e = error as CallerIdError;
      expect(e.code).toBe('EX_DATAERR');
      expect(e.source).toBe('flag');
      expect(e.message).toMatch(/Invalid caller id/);
    }
  });

  test('rejects env value with whitespace (source: env)', () => {
    try {
      resolveCallerId({ envOverride: 'foo bar' });
      expect.fail('expected CallerIdError');
    } catch (error) {
      const e = error as CallerIdError;
      expect(e.code).toBe('EX_DATAERR');
      expect(e.source).toBe('env');
    }
  });

  test('rejects platform fallback value with NUL (source: fallback)', () => {
    try {
      resolveCallerId({ env: { CLAUDE_CODE_SESSION_ID: 'foo\0bar' } });
      expect.fail('expected CallerIdError');
    } catch (error) {
      const e = error as CallerIdError;
      expect(e.code).toBe('EX_DATAERR');
      expect(e.source).toBe('fallback');
    }
  });

  test('rejects callerId that is too long (201 chars)', () => {
    try {
      resolveCallerId({ flagValue: 'a'.repeat(201) });
      expect.fail('expected CallerIdError');
    } catch (error) {
      const e = error as CallerIdError;
      expect(e.code).toBe('EX_DATAERR');
      expect(e.source).toBe('flag');
    }
  });
});

describe('CallerIdError metadata', () => {
  test('error carries code, source, and value', () => {
    try {
      resolveCallerId({ flagValue: 'bad/value' });
      expect.fail('expected CallerIdError');
    } catch (error) {
      const e = error as CallerIdError;
      expect(e.code).toBe('EX_DATAERR');
      expect(e.source).toBe('flag');
      expect(e.value).toBe('bad/value');
      expect(e.name).toBe('CallerIdError');
    }
  });
});
