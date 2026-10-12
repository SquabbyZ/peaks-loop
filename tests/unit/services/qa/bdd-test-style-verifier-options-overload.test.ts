// tests/unit/services/qa/bdd-test-style-verifier-options-overload.test.ts
//
// FIX B of rid-s3-artifact-contract-enforcement, kept in its own file so the arms
// do not push `bdd-test-style-verifier.test.ts` past the 500-line `tests/**` cap.
//
// THE DEFECT THESE ARMS PIN. `getCallbackBlock` in
// `src/services/qa/bdd-test-style-verifier.ts` read the callback at a FIXED
// position — `arguments[1]`. vitest accepts an options object between the
// description and the callback (`it(name, { timeout }, fn)`,
// `describe(name, SuiteOptions, fn)`), and this repo's own test files use that
// overload. On it, `arguments[1]` is the options object, which is neither an
// arrow nor a function expression, so the leading-comment check never ran and a
// file that IS conformant was reported `missing-given-when-then`. A real test
// file (`.husky` gate's own `pipeline-contract-gate.test.ts`) had to move its
// subprocess budget onto `describe` purely to dodge the misread.
//
// The fix finds the callback instead of assuming its position: the LAST argument
// that is an arrow function or a function expression. Both directions are pinned
// below — the overload with a triple is accepted, and the overload WITHOUT one
// still fails, at the callback block rather than at the call.

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { verifyBddStyle } from '~/src/services/qa/bdd-test-style-verifier';

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'bdd-options-overload-'));
});

/** The parent suite's fixture shape, kept local so this file stands alone. */
function writeTestFile(relPath: string, contents: string): string {
  writeFileSync(join(projectRoot, relPath), contents, 'utf8');
  return relPath;
}

describe('Scenario: behavior — callback after an options object', () => {
  it('when an options object sits between the description and the callback, should still accept the triple', () => {
    // given: an `it` whose callback is the THIRD argument, with the BDD triple
    // when:  the verifier scans the file
    // then:  it accepts — reading the options object here was the defect
    const file = writeTestFile(
      'opts-ok.test.ts',
      `import { it } from 'vitest';
it(
  'should accept a callback behind an options object',
  { timeout: 1000 },
  () => {
    // given: a precondition
    // when:  the case runs
    // then:  the triple is found in the callback block
  }
);`
    );
    const result = verifyBddStyle({ projectRoot, testFiles: [file] });
    expect(result).toEqual({ ok: true, scanned: 1 });
  });

  it('when an options object is present and the triple is missing, should still fail at the callback block', () => {
    // given: the same overload whose callback block carries NO triple
    // when:  the verifier scans the file
    // then:  it fails at the callback's `{` (line 5), not at the call's `it(` (line 2)
    //        — that difference is the proof the block was found
    const file = writeTestFile(
      'opts-missing.test.ts',
      `import { it, expect } from 'vitest';
it(
  'should still fail without the triple',
  { timeout: 1000 },
  () => {
    expect(1).toBe(1);
  }
);`
    );
    const result = verifyBddStyle({ projectRoot, testFiles: [file] });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected fail');
    expect(result.reason).toBe('missing-given-when-then');
    expect(result.line).toBe(5);
  });

  it('when a describe carries an options object, should walk the its nested inside it', () => {
    // given: a `describe(name, options, fn)` wrapper holding a conformant `it`
    // when:  the verifier scans the file
    // then:  the nested `it` is inspected and accepted
    const file = writeTestFile(
      'opts-describe.test.ts',
      `import { describe, it } from 'vitest';
describe('suite', { timeout: 1000 }, () => {
  it('should be walked, not misread', () => {
    // given: a precondition
    // when:  the case runs
    // then:  the nested callback is inspected
  });
});`
    );
    const result = verifyBddStyle({ projectRoot, testFiles: [file] });
    expect(result).toEqual({ ok: true, scanned: 1 });
  });

  it('when it is called with the plain two-argument form, should keep accepting the triple', () => {
    // given: `it(name, fn)`, the shape the fixed-position read already handled
    // when:  the verifier scans the file
    // then:  scanning from the end found the same callback as before
    const file = writeTestFile(
      'opts-plain.test.ts',
      `import { it } from 'vitest';
it('should keep the plain form working', () => {
  // given: a precondition
  // when:  the case runs
  // then:  the callback is still the second argument
});`
    );
    const result = verifyBddStyle({ projectRoot, testFiles: [file] });
    expect(result).toEqual({ ok: true, scanned: 1 });
  });
});
