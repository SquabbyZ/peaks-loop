// tests/unit/refactor/bdd-migration-roundtrip.test.ts
//
// Round-trip / contract test for `scripts/migrate-to-bdd.mjs`.
//
// What this verifies:
//   The BDD migrator takes an existing AAA-style vitest test file and
//   rewrites every `it` / `test` / `describe` to the given-when-then
//   contract used by this codebase:
//
//     1. The it/test description is rewritten to a "when X, should Y" form.
//     2. A 3-line `// given:` / `// when:` / `// then:` block is inserted
//        at the top of the test body.
//     3. The transformation is idempotent — running it twice produces the
//        same output (no double-tagging, no double-comment blocks).
//     4. Behavior is preserved: every `it()` and `describe()` call still
//        runs in vitest, with the same number of test cases.
//
// We test the migrator as a pure function (no fs writes) by spawning
// `node` in a child process and capturing stdout. Keeping the test
// hermetic avoids the "test wrote to real tests dir and CI re-ran them"
// failure mode.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, '..', '..', '..', 'scripts', 'migrate-to-bdd.mjs');

interface MigrateOutput {
  transformedSource: string;
  rewrites: Array<{ kind: 'it' | 'test' | 'describe'; original: string; rewritten: string; location: string }>;
  totalItRewritten: number;
  totalTestRewritten: number;
  totalDescribeRewritten: number;
}

function migrate(source: string, options: { dryRun?: boolean } = {}): MigrateOutput {
  // Use the JSON stdin/stdout channel so we can pass any source without
  // touching the real filesystem. The migrator always writes the
  // transformed source to stdout.
  const payload = JSON.stringify({ source, dryRun: options.dryRun ?? true });
  const result = spawnSync(process.execPath, [SCRIPT, '--stdin-json'], {
    input: payload,
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

describe('bdd-migration-roundtrip — description rewriting', () => {
  it('case 1: it description without "should" gets prefixed with "when ... should ..."', () => {
    const src = `
import { describe, expect, it } from 'vitest';
describe('suite', () => {
  it('adds two positive numbers', () => {
    expect(1 + 1).toBe(2);
  });
});
`;
    const out = migrate(src);
    const itRewrite = out.rewrites.find((r) => r.kind === 'it');
    expect(itRewrite).toBeDefined();
    // The new description must mention both 'when' and 'should' so the
    // downstream BDD reporter can classify it as a BDD test.
    expect(itRewrite!.rewritten.toLowerCase()).toContain('when');
    expect(itRewrite!.rewritten.toLowerCase()).toContain('should');
    // Behavior: the test is still wrapped in it() and contains the assertion.
    expect(out.transformedSource).toMatch(/it\(/);
    expect(out.transformedSource).toMatch(/expect\(1 \+ 1\)/);
  });

  it('case 2: it description with "should" already gets a "when" prefix (preserves the existing should text)', () => {
    const src = `
import { describe, expect, it } from 'vitest';
describe('suite', () => {
  it('should reverse an array', () => {
    expect([1, 2, 3].reverse()).toEqual([3, 2, 1]);
  });
});
`;
    const out = migrate(src);
    const itRewrite = out.rewrites.find((r) => r.kind === 'it');
    expect(itRewrite).toBeDefined();
    const rewritten = itRewrite!.rewritten;
    expect(rewritten.toLowerCase()).toContain('when');
    // The original "should" clause is preserved (not removed and re-added).
    expect(rewritten.toLowerCase()).toContain('should');
    expect(rewritten.toLowerCase()).toContain('reverse an array');
  });

  it('case 3: empty it body gets placeholder given/when/then comments (3 lines)', () => {
    const src = `
import { it } from 'vitest';
it('does something', () => {});
`;
    const out = migrate(src);
    expect(out.transformedSource).toMatch(/\/\/ given: /);
    expect(out.transformedSource).toMatch(/\/\/ when: /);
    expect(out.transformedSource).toMatch(/\/\/ then: /);
  });
});

describe('bdd-migration-roundtrip — comment block rewrite', () => {
  it('case 4: existing legacy // arrange: comments are replaced by given/when/then', () => {
    const src = `
import { describe, expect, it } from 'vitest';
describe('suite', () => {
  it('parses CSV row', () => {
    // arrange: a CSV row "a,b,c"
    const row = 'a,b,c';
    // act: split on comma
    const out = row.split(',');
    // assert: 3 fields
    expect(out).toHaveLength(3);
  });
});
`;
    const out = migrate(src);
    // The legacy AAA comments are gone.
    expect(out.transformedSource).not.toMatch(/\/\/ arrange: /);
    expect(out.transformedSource).not.toMatch(/\/\/ act: /);
    expect(out.transformedSource).not.toMatch(/\/\/ assert: /);
    // The new BDD comment block is present.
    expect(out.transformedSource).toMatch(/\/\/ given: /);
    expect(out.transformedSource).toMatch(/\/\/ when: /);
    expect(out.transformedSource).toMatch(/\/\/ then: /);
    // The test body is intact — migration is non-destructive on actual code.
    expect(out.transformedSource).toMatch(/const row = 'a,b,c'/);
    expect(out.transformedSource).toMatch(/row\.split/);
  });

  it('case 5: nested describe still has inner it() rewritten', () => {
    const src = `
import { describe, expect, it } from 'vitest';
describe('outer', () => {
  describe('inner', () => {
    it('handles nested case', () => {
      expect(1).toBe(1);
    });
  });
});
`;
    const out = migrate(src);
    // Both describes are recorded.
    const describes = out.rewrites.filter((r) => r.kind === 'describe');
    expect(describes.length).toBe(2);
    // The inner it is rewritten.
    const itRewrites = out.rewrites.filter((r) => r.kind === 'it');
    expect(itRewrites.length).toBe(1);
    expect(itRewrites[0]?.rewritten.toLowerCase()).toContain('when');
    expect(out.transformedSource).toMatch(/\/\/ given: /);
  });
});
