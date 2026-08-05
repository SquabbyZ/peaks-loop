// tests/unit/reporters/bdd-reporter.test.ts
//
// rid-2026-08-05-bdd-test-style Slice C — verifies the BDD reporter
// emits the documented Feature / Scenario / Given / When / Then shape
// for passing, failing, multi-describe, and empty test files.
//
// Strategy:
//   We spawn `pnpm vitest run` as a subprocess with the reporter flag
//   pointing at the local source file. The reporter writes its output
//   to stdout via `console.log`; we capture stdout and assert on the
//   text. We do NOT import the reporter class directly because vitest
//   owns its lifecycle; the only public surface is the rendered
//   document.
//
// Anti-fake-green rule (CLI silent-catch):
//   The test asserts on real vitest subprocess output, not on a mocked
//   or in-memory stub. A regression in the reporter (e.g. accidentally
//   printing only on success) would surface as a real stdout mismatch.
//
// Karpathy note:
//   4 cases total per rid acceptance criterion 7. We use minimal tmp
//   test files (5-15 lines each); the cost of an extra describe would
//   not add coverage, so we do not pad.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * vitest's include glob in vitest.config.ts is `tests/unit/**\/*.test.ts`.
 * We must write our fixture test files under `tests/unit/` (not OS tmp)
 * so vitest actually discovers them. We nest under a `_bdd-reporter-tmp`
 * subdirectory and tear it down after every case; .gitignore already
 * excludes any underscore-prefixed scratch dir under tests/.
 */
const FIXTURE_BASE = join(process.cwd(), 'tests', 'unit', '_bdd-reporter-tmp');

const REPORTER = join(
  process.cwd(),
  'src',
  'reporters',
  'bdd-reporter.ts',
);

/** Per-case tmp dir so we never pollute the real tests/ tree. */
let tmpDir = '';
afterEach(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = '';
  }
});

/**
 * Build a fresh fixture directory under `tests/unit/_bdd-reporter-tmp/`
 * and write a single test file into it. vitest's include glob picks it
 * up because it lives under `tests/unit/**`. The dir is removed in
 * `afterEach` so no state survives across cases.
 */
function writeTestFile(name: string, body: string): string {
  mkdirSync(FIXTURE_BASE, { recursive: true });
  tmpDir = mkdtempSync(join(FIXTURE_BASE, 'case-'));
  const file = join(tmpDir, `${name}.test.ts`);
  writeFileSync(file, body);
  return file;
}

interface RunResult {
  stdout: string;
  status: number;
}

/**
 * Spawn vitest pointed at a single test file with the BDD reporter
 * enabled. We invoke vitest's own .mjs entry directly to avoid the
 * Windows `spawnSync pnpm.cmd EINVAL` quirk; passing the .mjs path
 * through `node` is deterministic on every platform.
 */
function runWithReporter(testFileAbsPath: string): RunResult {
  const vitestBin = join(
    process.cwd(),
    'node_modules',
    'vitest',
    'vitest.mjs',
  );
  const result = spawnSync(
    process.execPath,
    [
      vitestBin,
      'run',
      '--no-color',
      '--reporter',
      REPORTER,
      testFileAbsPath,
    ],
    {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: '1' },
    },
  );
  if (result.error) throw result.error;
  return {
    stdout: (result.stdout ?? '') + (result.stderr ?? ''),
    status: result.status ?? 1,
  };
}

describe('bdd-reporter — passing tests', () => {
  it('case 1: passing test emits Feature + Scenario + Given/When/Then pass line', () => {
    const file = writeTestFile(
      'happy-path',
      `import { describe, expect, it } from 'vitest';
describe('happy path', () => {
  it('when adding two numbers, should sum them', () => {
    expect(1 + 1).toBe(2);
  });
});
`,
    );
    const { stdout } = runWithReporter(file);
    expect(stdout).toMatch(/Feature: happy-path\.test\.ts/);
    expect(stdout).toMatch(/Scenario: happy path/);
    expect(stdout).toMatch(/Given when adding two numbers, should sum them/);
    expect(stdout).toMatch(/Then\s+should pass/);
    // Failing-only branch must NOT appear on a green run.
    expect(stdout).not.toMatch(/FAILED:/);
  }, 60_000);
});

describe('bdd-reporter — failing tests', () => {
  it('case 2: failing test emits FAILED: <name> + error reason', () => {
    const file = writeTestFile(
      'broken-path',
      `import { describe, expect, it } from 'vitest';
describe('broken path', () => {
  it('when dividing by zero, should throw', () => {
    expect(1 / 0).toBe(42);
  });
});
`,
    );
    const { stdout, status } = runWithReporter(file);
    expect(status).not.toBe(0);
    expect(stdout).toMatch(/Feature: broken-path\.test\.ts/);
    expect(stdout).toMatch(/FAILED: when dividing by zero, should throw/);
    // The truncated error reason must include the assertion failure text.
    // vitest 4.x emits "expected <actual> to be <expected>" — we assert
    // loosely on the actual + expected values to stay format-stable.
    expect(stdout).toMatch(/Infinity/);
    expect(stdout).toMatch(/42/);
  }, 60_000);
});

describe('bdd-reporter — nested describes', () => {
  it('case 3: multiple nested describes produce multiple Scenarios under one Feature', () => {
    const file = writeTestFile(
      'multi-describe',
      `import { describe, expect, it } from 'vitest';
describe('outer', () => {
  describe('inner-a', () => {
    it('when A, should produce A', () => {
      expect('a').toBe('a');
    });
  });
  describe('inner-b', () => {
    it('when B, should produce B', () => {
      expect('b').toBe('b');
    });
  });
});
`,
    );
    const { stdout } = runWithReporter(file);
    expect(stdout).toMatch(/Feature: multi-describe\.test\.ts/);
    // At least two distinct Scenario labels must appear.
    const scenarios = stdout.match(/Scenario: [^\n]+/g) ?? [];
    expect(scenarios.length).toBeGreaterThanOrEqual(2);
    expect(stdout).toMatch(/Scenario: inner-a/);
    expect(stdout).toMatch(/Scenario: inner-b/);
  }, 60_000);
});

describe('bdd-reporter — empty test file', () => {
  it('case 4: test file with no it() blocks emits Feature line but zero Scenarios', () => {
    const file = writeTestFile(
      'empty-suite',
      `import { describe, expect, it } from 'vitest';
describe('no tests here', () => {
  // intentionally empty
});
`,
    );
    const { stdout } = runWithReporter(file);
    expect(stdout).toMatch(/Feature: empty-suite\.test\.ts/);
    // No Scenario lines for the empty describe — it never ran a test.
    // (The header may still print "no tests ran" — we only assert
    // Scenario: lines are absent.)
    expect(stdout).not.toMatch(/Scenario: no tests here/);
    expect(stdout).not.toMatch(/FAILED:/);
  }, 60_000);
});