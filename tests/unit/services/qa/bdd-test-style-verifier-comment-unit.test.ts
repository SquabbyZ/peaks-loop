// tests/unit/services/qa/bdd-test-style-verifier-comment-unit.test.ts
//
// THE DEFECT THESE ARMS PIN (backlog §2.17). `checkBlockLeadingComments` took
// the first three NON-EMPTY LINES of the callback block, but
// `contracts/test-style-contract.md` §1.2 says the body must start with
// "exactly three leading COMMENTS". The unit was wrong in both directions:
//   - a `given:` wrapped onto a hanging-indented second line consumed a slot,
//     pushed `// when:` out of the triple, and a conformant case was REFUSED;
//   - a fourth and fifth leading comment before the first statement were
//     never read, so a body the contract forbids was ACCEPTED.
// The reported line was also off by one: it anchored on the `{` (and with it
// the `it(` line) rather than on the first body line.
//
// The unit is now the leading comment: a keyword line plus hanging-indented
// continuation lines counts as one. Both directions are pinned below, along
// with the rule that only the region BEFORE executable code is constrained —
// the contract says nothing about comments after it.

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { verifyBddStyle } from '~/src/services/qa/bdd-test-style-verifier';

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'bdd-comment-unit-'));
});

/** The parent suite's fixture shape, kept local so this file stands alone. */
function writeTestFile(relPath: string, contents: string): string {
  writeFileSync(join(projectRoot, relPath), contents, 'utf8');
  return relPath;
}

describe('Scenario: behavior — the leading comment is the unit', () => {
  it('when given:/when: wrap onto continuation lines, should accept the triple', () => {
    // given: the shape of the 2026-09-25 false refusal — a given: and a when:
    //        each wrapped with a hanging indent
    // when:  the verifier scans the file
    // then:  it accepts; counting lines used to shift `when:` into slot 3
    const file = writeTestFile(
      'wrapped.test.ts',
      `import { it, expect } from 'vitest';
it('when a nested emit is deleted, should report the package stale', () => {
  // given: a package built from a top-level AND a nested source, stamped
  //        after both sources were written
  // when:  the nested emit is deleted with its source untouched — the
  //        mutation measured on the real repository
  // then:  stale, not fresh
  expect(1).toBe(1);
});`
    );

    const result = verifyBddStyle({ projectRoot, testFiles: [file] });

    expect(result).toEqual({ ok: true, scanned: 1 });
  });

  it('when the then: comment wraps, should accept the triple', () => {
    // given: a triple whose last comment continues on a second line
    // when:  the verifier scans the file
    // then:  the continuation folds into `then:` and the triple is accepted
    const file = writeTestFile(
      'wrapped-then.test.ts',
      `import { it, expect } from 'vitest';
it('when a value is computed, should report the outcome', () => {
  // given: a value
  // when:  the function is invoked
  // then:  the result equals the expected output,
  //        including its type
  expect(1 + 1).toBe(2);
});`
    );

    const result = verifyBddStyle({ projectRoot, testFiles: [file] });

    expect(result).toEqual({ ok: true, scanned: 1 });
  });

  it('when a fourth leading comment sits before the first statement, should refuse it', () => {
    // given: the contract says "exactly three leading comments", and a fifth
    //        comment line used to sail through because only three were read
    // when:  the verifier scans the file
    // then:  it refuses at the first comment line
    const file = writeTestFile(
      'five-comments.test.ts',
      `import { it, expect } from 'vitest';
it('when scanned, should refuse a fourth leading comment', () => {
  // given: precondition
  // when:  action
  // then:  outcome
  // note: one
  // note: two
  expect(1).toBe(1);
});`
    );

    const result = verifyBddStyle({ projectRoot, testFiles: [file] });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected fail');
    expect(result.reason).toBe('missing-given-when-then');
    expect(result.line).toBe(3);
  });

  it('when a comment follows executable code, should accept it', () => {
    // given: the contract constrains only the comments "before any executable
    //        code" — it does not forbid comments after it
    // when:  the verifier scans the file
    // then:  the trailing comment is outside the leading region and is ignored
    const file = writeTestFile(
      'trailing-comment.test.ts',
      `import { it, expect } from 'vitest';
it('when a value is computed, should ignore a trailing comment', () => {
  // given: a value
  // when:  the function is invoked
  // then:  the result is correct
  expect(1 + 1).toBe(2);
  // control: the assertion above cannot pass vacuously
  expect(2 + 2).toBe(4);
});`
    );

    const result = verifyBddStyle({ projectRoot, testFiles: [file] });

    expect(result).toEqual({ ok: true, scanned: 1 });
  });

  it('when the triple is reordered, should still refuse it', () => {
    // given: the same three comments with `when:` before `given:`
    // when:  the verifier scans the file
    // then:  the order rule still rejects the body
    const file = writeTestFile(
      'reordered.test.ts',
      `import { it, expect } from 'vitest';
it('when scanned, should refuse a reordered triple', () => {
  // when:  action
  // given: precondition
  // then:  outcome
  expect(1).toBe(1);
});`
    );

    const result = verifyBddStyle({ projectRoot, testFiles: [file] });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected fail');
    expect(result.reason).toBe('missing-given-when-then');
  });

  it('when the triple is missing, should report the first body line, not the it( line', () => {
    // given: a callback with no BDD comments at all
    // when:  the verifier scans the file
    // then:  the reported line is line 3 — the first body line — not line 2
    const file = writeTestFile(
      'line-report.test.ts',
      `import { it, expect } from 'vitest';
it('when a value is computed, should fail without the triple', () => {
  expect(1).toBe(1);
});`
    );

    const result = verifyBddStyle({ projectRoot, testFiles: [file] });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected fail');
    expect(result.file).toBe('line-report.test.ts');
    expect(result.line).toBe(3);
  });
});
