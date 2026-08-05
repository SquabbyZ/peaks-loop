// tests/unit/services/qa/bdd-test-style-verifier.test.ts
//
// 4-dimension unit test for the BDD test-style verifier at
// src/services/qa/bdd-test-style-verifier.ts. The verifier is the
// peaks-qa verification-time companion to `scripts/migrate-to-bdd.mjs`
// (Slice A): where the migrator rewrites a test file into given-when-then
// form, the verifier reads a candidate file and emits a structured
// verdict. The two halves of the BDD contract (description + body
// comments) are exercised independently so a regression in either
// half is loud and localized.
//
// Dimensions covered:
//   - behavior:   every individual rule (description + body) plus
//                 the round-trip with the Slice A migrator
//   - render:     the structured BddStyleVerdict shape for both
//                 ok and fail outcomes
//   - integration: tmp workspace + on-disk test file fixtures
//   - a11y:       failure messages include file:line + a stable
//                 `expected` string the caller can surface to the
//                 user

import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/qa/bdd-test-style-verifier.test.ts',
  ['render', 'behavior', 'integration', 'a11y'],
);

import { verifyBddStyle, type BddStyleVerdict } from '~/src/services/qa/bdd-test-style-verifier';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATOR_SCRIPT = join(__dirname, '..', '..', '..', '..', 'scripts', 'migrate-to-bdd.mjs');

interface MigrateOutput {
  transformedSource: string;
  rewrites: Array<{ kind: 'it' | 'test' | 'describe'; original: string; rewritten: string; location: string }>;
  totalItRewritten: number;
  totalTestRewritten: number;
  totalDescribeRewritten: number;
}

function runMigrator(source: string): MigrateOutput {
  // Match the Slice A `bdd-migration-roundtrip.test.ts` shape:
  // subprocess JSON to avoid the missing-types problem of importing
  // a `.mjs` script directly from TS.
  const result = spawnSync(process.execPath, [MIGRATOR_SCRIPT, '--stdin-json'], {
    input: JSON.stringify({ source, dryRun: false }),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `migrator exited with status ${result.status}; stderr:\n${result.stderr}\nstdout:\n${result.stdout}`,
    );
  }
  return JSON.parse(result.stdout) as MigrateOutput;
}

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'bdd-verifier-'));
});

afterEach(() => {
  // tmpdir on Windows is process-managed; explicit cleanup is
  // not required but keeps the test run tidy.
});

function writeTestFile(relPath: string, contents: string): string {
  const abs = join(projectRoot, relPath);
  // Flatten nested dirs in a portable way without pulling in mkdir
  // best-effort: the caller picks a flat path for unit tests.
  writeFileSync(abs, contents, 'utf8');
  return relPath;
}

// ---- behavior: description rules -------------------------------------------

describe("Scenario: behavior — description rules", () => {
  it("when description contains 'should', should return ok", () => {
    const file = writeTestFile(
      'a.test.ts',
      `import { it } from 'vitest';
it('should do the thing', () => {
  // given: precondition
  // when:  action
  // then:  outcome
});`,
    );
    const result = verifyBddStyle({ projectRoot, testFiles: [file] });
    expect(result).toEqual({ ok: true, scanned: 1 });
  });

  it("when description contains 'when', should return ok", () => {
    const file = writeTestFile(
      'b.test.ts',
      `import { it } from 'vitest';
it('when the input is empty, returns the fallback', () => {
  // given: precondition
  // when:  action
  // then:  outcome
});`,
    );
    const result = verifyBddStyle({ projectRoot, testFiles: [file] });
    expect(result).toEqual({ ok: true, scanned: 1 });
  });

  it("when description contains neither 'should' nor 'when', should return description-no-should-when", () => {
    const file = writeTestFile(
      'c.test.ts',
      `import { it } from 'vitest';
it('does the thing', () => {
  // given: precondition
  // when:  action
  // then:  outcome
});`,
    );
    const result = verifyBddStyle({ projectRoot, testFiles: [file] });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected fail');
    expect(result.reason).toBe('description-no-should-when');
    expect(result.file).toBe('c.test.ts');
    expect(result.line).toBe(2);
    expect(result.description).toBe('does the thing');
  });
});

// ---- behavior: body comment rules ------------------------------------------

describe("Scenario: behavior — body comment rules", () => {
  it("when body has full given/when/then triple at the top, should return ok", () => {
    const file = writeTestFile(
      'd.test.ts',
      `import { it, expect } from 'vitest';
it('should compute a value', () => {
  // given: a non-empty input
  // when:  the function is invoked
  // then:  the result equals the expected output
  expect(1 + 1).toBe(2);
});`,
    );
    const result = verifyBddStyle({ projectRoot, testFiles: [file] });
    expect(result).toEqual({ ok: true, scanned: 1 });
  });

  it("when 'given' comment is missing, should return missing-given-when-then", () => {
    const file = writeTestFile(
      'e.test.ts',
      `import { it, expect } from 'vitest';
it('should compute a value', () => {
  // when:  the function is invoked
  // then:  the result equals the expected output
  expect(1 + 1).toBe(2);
});`,
    );
    const result = verifyBddStyle({ projectRoot, testFiles: [file] });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected fail');
    expect(result.reason).toBe('missing-given-when-then');
    expect(result.file).toBe('e.test.ts');
  });

  it("when 'when' comment is missing, should return missing-given-when-then", () => {
    const file = writeTestFile(
      'f.test.ts',
      `import { it, expect } from 'vitest';
it('should compute a value', () => {
  // given: a non-empty input
  // then:  the result equals the expected output
  expect(1 + 1).toBe(2);
});`,
    );
    const result = verifyBddStyle({ projectRoot, testFiles: [file] });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected fail');
    expect(result.reason).toBe('missing-given-when-then');
  });

  it("when 'then' comment is missing, should return missing-given-when-then", () => {
    const file = writeTestFile(
      'g.test.ts',
      `import { it, expect } from 'vitest';
it('should compute a value', () => {
  // given: a non-empty input
  // when:  the function is invoked
  expect(1 + 1).toBe(2);
});`,
    );
    const result = verifyBddStyle({ projectRoot, testFiles: [file] });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected fail');
    expect(result.reason).toBe('missing-given-when-then');
  });
});

// ---- behavior: AST robustness (no false positives) -------------------------

describe("Scenario: behavior — AST robustness", () => {
  it("when 'when' is only inside a string literal, should still fail on the description", () => {
    // The word "when" is inside an `it` title string but the
    // description itself ('returns the value when asked') actually
    // does contain "when" — so this case is OK. To exercise the
    // false-positive guard, we use a description that mentions
    // 'when' only in a *substring* of another word, e.g. "nowhere"
    // contains "when" as a non-word-boundary match. The verifier's
    // /(\bwhen\b|\bshould\b)/i regex must reject this.
    const file = writeTestFile(
      'h.test.ts',
      `import { it, expect } from 'vitest';
it('returns the value nowhere in particular', () => {
  // given: a non-empty input
  // when:  the function is invoked
  // then:  the result equals the expected output
  expect(1).toBe(1);
});`,
    );
    const result = verifyBddStyle({ projectRoot, testFiles: [file] });
    // "nowhere" contains "when" as a substring but NOT as a
    // whole word. The verifier must reject.
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected fail on substring match');
    expect(result.reason).toBe('description-no-should-when');
  });

  it("when 'when' is inside the test body as a string, should not affect the description verdict", () => {
    // This is the inverse of the substring guard: ensure the
    // verifier does NOT mistakenly accept a description because
    // the word 'when' appears in a string literal deeper in the
    // test body. The description 'renders the widget' has no
    // when/should; the body string 'when X happens' is a
    // separate AST node.
    const file = writeTestFile(
      'i.test.ts',
      `import { it, expect } from 'vitest';
it('renders the widget', () => {
  // given: a non-empty input
  // when:  the function is invoked
  // then:  the result equals the expected output
  expect('when X happens').toBe('when X happens');
});`,
    );
    const result = verifyBddStyle({ projectRoot, testFiles: [file] });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected fail');
    expect(result.reason).toBe('description-no-should-when');
  });
});

// ---- behavior: nested describe / multiple files ---------------------------

describe("Scenario: behavior — describe nesting + multi-file scan", () => {
  it("when it is nested inside describe, should inspect every it in the tree", () => {
    const file = writeTestFile(
      'j.test.ts',
      `import { it, expect, describe } from 'vitest';
describe('outer', () => {
  it('should pass A', () => {
    // given: precondition
    // when:  action
    // then:  outcome
    expect(1).toBe(1);
  });
  describe('inner', () => {
    it('should pass B', () => {
      // given: precondition
      // when:  action
      // then:  outcome
      expect(1).toBe(1);
    });
  });
});`,
    );
    const result = verifyBddStyle({ projectRoot, testFiles: [file] });
    expect(result).toEqual({ ok: true, scanned: 2 });
  });

  it("when scanning multiple files, should return the first failure (file order, then line order)", () => {
    const ok = writeTestFile(
      'k-ok.test.ts',
      `import { it } from 'vitest';
it('should pass', () => {
  // given: precondition
  // when:  action
  // then:  outcome
});`,
    );
    const bad = writeTestFile(
      'l-bad.test.ts',
      `import { it } from 'vitest';
it('plain text', () => {
  // given: precondition
  // when:  action
  // then:  outcome
});`,
    );
    const result = verifyBddStyle({ projectRoot, testFiles: [ok, bad] });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected fail');
    expect(result.file).toBe('l-bad.test.ts');
    expect(result.reason).toBe('description-no-should-when');
  });
});

// ---- behavior: edge cases --------------------------------------------------

describe("Scenario: behavior — edge cases", () => {
  it("when the test file is empty, should return ok with scanned=0", () => {
    const file = writeTestFile('empty.test.ts', '');
    const result = verifyBddStyle({ projectRoot, testFiles: [file] });
    expect(result).toEqual({ ok: true, scanned: 0 });
  });

  it("when the test file is empty (no .test.ts) and the list is empty, should return ok with scanned=0", () => {
    const result = verifyBddStyle({ projectRoot, testFiles: [] });
    expect(result).toEqual({ ok: true, scanned: 0 });
  });
});

// ---- behavior: round-trip with Slice A migrator ---------------------------

describe("Scenario: behavior — round-trip with Slice A migrator", () => {
  it("when a legacy AAA test file is migrated by Slice A, the verifier should accept the result", () => {
    // Take a known-AAA sample, run it through the Slice A migrator,
    // then verify the output. This is the only test that depends on
    // the migrator — it pins the contract between the two halves
    // of the BDD enforcement stack.
    const legacy = [
      `import { it, expect } from 'vitest';`,
      `it('does the legacy AAA thing', () => {`,
      `  // arrange: a value`,
      `  // act: call the function`,
      `  // assert: the result is correct`,
      `  expect(1 + 1).toBe(2);`,
      `});`,
      ``,
    ].join('\n');
    const migrated = runMigrator(legacy);
    const file = writeTestFile('rt.test.ts', migrated.transformedSource);
    const result: BddStyleVerdict = verifyBddStyle({
      projectRoot,
      testFiles: [file],
    });
    expect(result).toEqual({ ok: true, scanned: 1 });
  });
});

// ---- render: verdict shape -------------------------------------------------

describe("Scenario: render — verdict shape", () => {
  it("when ok, should expose { ok: true, scanned } exactly", () => {
    const file = writeTestFile(
      'shape-ok.test.ts',
      `import { it } from 'vitest';
it('should render ok', () => {
  // given: a
  // when:  b
  // then:  c
});`,
    );
    const result = verifyBddStyle({ projectRoot, testFiles: [file] });
    expect(Object.keys(result).sort()).toEqual(['ok', 'scanned']);
  });

  it("when fail, should expose { ok, reason, file, line, expected } for missing-given-when-then", () => {
    const file = writeTestFile(
      'shape-fail.test.ts',
      `import { it } from 'vitest';
it('should render fail', () => {
  expect(1).toBe(1);
});`,
    );
    const result = verifyBddStyle({ projectRoot, testFiles: [file] });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected fail');
    expect(result.reason).toBe('missing-given-when-then');
    expect(typeof result.file).toBe('string');
    expect(typeof result.line).toBe('number');
    expect(typeof result.expected).toBe('string');
  });

  it("when fail on description, should expose the original description for the caller to surface", () => {
    // The description must contain neither 'when' nor 'should' as a
    // whole word, so we use 'plain assertion' which has neither.
    const file = writeTestFile(
      'shape-desc.test.ts',
      `import { it } from 'vitest';
it('plain assertion that fails the description rule', () => {
  // given: a
  // when:  b
  // then:  c
});`,
    );
    const result = verifyBddStyle({ projectRoot, testFiles: [file] });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected fail');
    expect(result.reason).toBe('description-no-should-when');
    expect(result.description).toBe('plain assertion that fails the description rule');
  });
});
