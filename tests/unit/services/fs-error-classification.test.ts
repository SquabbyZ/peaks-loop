// tests/unit/services/fs-error-classification.test.ts
//
// S6 (2026-09-15) — the predicate behind the two P1 silent-catch closures
// (`post-compact-detector`, `step-08-gate`).
//
// Both catches used to name the two JS error classes they would rethrow
// (`ReferenceError`, `SyntaxError`) and swallow everything else, with a comment
// claiming they "narrow to IO errors only". That comment was false in the
// direction that matters: naming what to RETHROW swallows every class you did
// not think of, so the more unexpected the failure the more certainly it was
// hidden. The predicate inverts it — name the fs-miss codes to SWALLOW, let the
// rest propagate — and this file pins the boundary of that set.
//
// Dimensions covered:
//   - behavior:    the accept/reject boundary of the fs-miss set
//   - integration: OMITTED — the two call sites are covered by their own tests
//   - render:      OMITTED — pure predicate, no output
//   - a11y:        OMITTED — no human-facing text

import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { isExpectedFsMiss } from '../../../src/shared/fs-utils.js';

declareDimensions(
  'tests/unit/services/fs-error-classification.test.ts',
  ['behavior'],
  [
    { dim: 'integration', reason: 'the two call sites are covered by tests/unit/code/{post-compact-detector,step-08-gate}.test.ts' },
    { dim: 'render', reason: 'pure predicate; renders nothing' },
    { dim: 'a11y', reason: 'no human-facing text' },
  ],
);

/** Exactly what Node throws for a failed `fs` call. */
function fsError(code: string): Error {
  return Object.assign(new Error(`${code}: something went wrong`), { code, errno: -1, syscall: 'open' });
}

describe('Scenario: behavior — isExpectedFsMiss', () => {
  it('accepts the codes a caller may legitimately turn into a fallback value', () => {
    for (const code of ['ENOENT', 'ENOTDIR', 'EISDIR', 'EACCES', 'EPERM', 'ELOOP', 'ENAMETOOLONG']) {
      expect(isExpectedFsMiss(fsError(code)), code).toBe(true);
    }
  });

  it('rejects every error that is not an fs miss — including the ones the old catches swallowed', () => {
    // A plain Error with no `code`: unknown failure, NOT an absence.
    expect(isExpectedFsMiss(new Error('something broke'))).toBe(false);
    // The class the old catch nominally rethrew and the classes it did not.
    expect(isExpectedFsMiss(new ReferenceError('require is not defined'))).toBe(false);
    expect(isExpectedFsMiss(new SyntaxError('bad JSON'))).toBe(false);
    expect(isExpectedFsMiss(new TypeError('cannot read properties of undefined'))).toBe(false);
    // A non-fs error carrying a `code` is still not an fs miss.
    expect(isExpectedFsMiss(Object.assign(new Error('nope'), { code: 'ERR_INVALID_ARG_TYPE' }))).toBe(false);
  });

  it('never throws on a hostile value (it runs inside catch blocks)', () => {
    for (const value of [null, undefined, 0, '', 'ENOENT', {}, [], Symbol('x')]) {
      expect(() => isExpectedFsMiss(value)).not.toThrow();
      expect(isExpectedFsMiss(value)).toBe(false);
    }
  });
});
