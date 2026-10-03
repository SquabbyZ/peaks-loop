// tests/unit/lint/generator-determinism.test.ts
//
// Rid `2026-10-03-shadow-move-rider` W2: prove the baseline generator is
// DETERMINISTIC — the arm that would have caught §2.46 before the commit that carried
// it. §2.46 is the fact that the artifact's non-gated `shadow` block understated
// reality and nobody noticed: re-running the generator by hand after the commit was
// the only detector, and nobody re-runs by hand. Three levels, all required:
//
//   1. STRUCTURAL — the artifact document built twice from one measurement is
//      byte-identical once `generatedAt` is normalised, and under a different clock
//      the two texts differ on that ONE line and nowhere else (no `Date`/`Date.now`
//      leaked into any other field). Asserted as STRINGS, not objects: a
//      key-insertion-order change is invisible to a deep object compare and is a wall
//      of diff in a committed 280 KB JSON.
//   2. REAL DOUBLE RUN — in a `mkdtempSync` fixture with its own `git init`, run #2's
//      artifact differs from run #1's in `generatedAt` and nothing else. Tagged
//      `@slow` so the repository's own lanes decide when two generator runs are paid
//      for, and never run against this repository's real tree (that would rewrite the
//      published artifact from inside a test).
//   3. THE REGRESSION THIS SLICE EXISTS FOR — an exempt file entering the git index
//      raises the shadow, W1's rise line prints, and the exit code is what it was
//      without the warning. The determinism arm's POSITIVE CONTROL is the same event:
//      without it, "the bytes are stable" would be a claim nothing can falsify.
//
// eslint/tsc/silent-warning are stubbed by the harness (the fixture's own zeroes);
// prettier and the census are real. Nothing here writes into this repository.

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import { REPO_ROOT } from '../standards/_file-size-cap-scan.js';
import { FILE_SIZE_CAP_TESTS } from '../../../src/services/scan/file-size-policy.js';
import { createFixture, type Fixture } from './_file-size-hooks-fixture.js';

declareDimensions(
  'tests/unit/lint/generator-determinism.test.ts',
  ['behavior', 'integration', 'render', 'a11y'],
  []
);

const GENERATOR_REL = join('.husky', 'peaks-gate-baseline.mjs');
const ARTIFACT_REL = join('.peaks', 'lint', 'gate-baseline.json');

/** The one field the bytes legs are allowed to ignore. */
const GENERATED_AT = /"generatedAt": "[^"]*"/;

type DocumentInput = {
  scope: string[];
  lint: {
    coverageGapFiles: string[];
    notLinted: string[];
    phantomRules: Set<string>;
    syntaxErrorFiles: string[];
  };
  format: { unparsable: string[] };
  size: Record<string, unknown>;
  ceilings: Record<string, number>;
  files: Record<string, unknown>;
  shadow: Record<string, unknown>;
};

/** Load the byte builder where it lives; never restate it here. */
async function loadArtifactModule(): Promise<{
  artifactDocumentText: (input: DocumentInput) => string;
}> {
  const module = (await import(
    pathToFileURL(join(REPO_ROOT, '.husky', 'baseline', 'artifact.mjs')).href
  )) as Record<string, unknown>;
  const build = module.artifactDocumentText;
  if (typeof build !== 'function') {
    throw new Error('.husky/baseline/artifact.mjs exports no `artifactDocumentText`');
  }
  return { artifactDocumentText: build as (input: DocumentInput) => string };
}

/** One measurement, in the shapes the legs actually return. */
function measurement(shadowFiles = 558): DocumentInput {
  const gated = ['packages/p/src/c.ts', 'src/a.ts', 'src/b.ts'];
  const files: Record<string, unknown> = {};
  for (const file of gated) files[file] = { eslint: 0, eslintErrors: 0, notLinted: false };
  return {
    scope: gated,
    lint: {
      coverageGapFiles: ['src/b.ts'],
      notLinted: [],
      phantomRules: new Set(['no-console', '@typescript-eslint/no-explicit-any']),
      syntaxErrorFiles: []
    },
    format: { unparsable: [] },
    size: {
      env: {
        convention: 'split(String.fromCharCode(10)).length',
        caps: { defaultCap: 300, testsCap: 500 },
        scope: { dirs: ['src', 'tests', 'packages', 'scripts'], extensions: ['ts'] },
        hooks: {
          overCap: 0,
          excessLines: 0,
          caps: { hooksCap: 300 },
          scope: { dirs: ['.husky'], extensions: ['mjs'] },
          convention: 'split(String.fromCharCode(10)).length'
        }
      }
    },
    ceilings: { eslintFindings: 0, fileSizeOverCap: 0, fileSizeExcessLines: 0 },
    files,
    shadow: { scopeDirs: ['tests'], measuredFiles: shadowFiles, eslintFindings: 639 }
  };
}

/** Freeze the clock so "only `generatedAt` moved" is something the arm can force. */
function withDate<T>(ms: number, body: () => T): T {
  const RealDate = Date;
  const frozen = new RealDate(ms);
  globalThis.Date = function FakeDate() {
    return frozen;
  } as unknown as DateConstructor;
  try {
    return body();
  } finally {
    globalThis.Date = RealDate;
  }
}

/** The lines on which two artifact texts differ, each labelled with its content. */
function diffLines(a: string, b: string): string[] {
  const la = a.split('\n');
  const lb = b.split('\n');
  const out: string[] = [];
  for (let i = 0; i < Math.max(la.length, lb.length); i += 1) {
    const x = la[i] ?? '<absent>';
    const y = lb[i] ?? '<absent>';
    if (x !== y) out.push(`line ${String(i + 1)}: ${x.trim()} || ${y.trim()}`);
  }
  return out;
}

let fx: Fixture | null = null;
function fixture(): Fixture {
  if (fx === null) fx = createFixture('generator-determinism');
  return fx;
}

type GenRun = { code: number; stdout: string; stderr: string; artifact: string };

function generatorRun(args: readonly string[] = []): GenRun {
  const f = fixture();
  const spawned = spawnSync(process.execPath, [GENERATOR_REL, ...args], {
    cwd: f.root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024
  });
  // A spawn failure is "did not run", never "identical bytes".
  if (spawned.error !== undefined) throw spawned.error;
  return {
    code: spawned.status ?? 1,
    stdout: spawned.stdout ?? '',
    stderr: spawned.stderr ?? '',
    artifact: f.read(ARTIFACT_REL)
  };
}

const docOf = (text: string): Record<string, unknown> =>
  JSON.parse(text) as Record<string, unknown>;
const shadowOf = (text: string): Record<string, unknown> =>
  docOf(text).shadow as Record<string, unknown>;
const riseLines = (stderr: string): string[] =>
  stderr.split('\n').filter((line) => line.startsWith('WARNING: shadow moved up:'));

let equalRun: GenRun | null = null;
let secondArtifact = '';
let run3: GenRun | null = null;

afterAll(() => {
  fx?.cleanup();
});

describe('Scenario: behavior — the byte builder is deterministic over one measurement', () => {
  it('the same measurement built twice is byte-identical once generatedAt is normalised', async () => {
    const { artifactDocumentText } = await loadArtifactModule();
    const input = measurement();
    const a = withDate(1730000000000, () => artifactDocumentText(input));
    const b = withDate(1730000000000, () => artifactDocumentText(input));
    expect(a.replace(GENERATED_AT, '"generatedAt": "<dt>"')).toBe(
      b.replace(GENERATED_AT, '"generatedAt": "<dt>"')
    );
    expect(GENERATED_AT.test(a), 'the field the leg normalises').toBe(true);
  });

  it('a different clock moves exactly one line, and that line is generatedAt', async () => {
    const { artifactDocumentText } = await loadArtifactModule();
    const input = measurement();
    const a = withDate(1730000000000, () => artifactDocumentText(input));
    const b = withDate(1730000900000, () => artifactDocumentText(input));
    const moved = diffLines(a, b);
    expect(moved.length, moved.join('\n')).toBe(1);
    expect(moved[0]).toContain('"generatedAt"');
    // Anti-vacuity: had the clock not moved, this arm would compare one string with
    // itself and report a determinism it never observed.
    expect(a).not.toBe(b);
    expect(diffLines(a, b).join('\n')).not.toContain('phantomRules');
    expect(diffLines(a, b).join('\n')).not.toContain('shadow');
  });

  it('POSITIVE CONTROL: the byte comparison does see a measurement that moved', async () => {
    const { artifactDocumentText } = await loadArtifactModule();
    const clock = 1730000000000;
    const before = withDate(clock, () => artifactDocumentText(measurement(558)));
    const after = withDate(clock, () => artifactDocumentText(measurement(559)));
    const moved = diffLines(before, after);
    expect(moved.length, moved.join('\n')).toBe(1);
    expect(moved[0]).toContain('"measuredFiles": 55');
  });

  it('the dir derivations are sorted, so a Set cannot leak its iteration order into bytes', async () => {
    const rule = (await import(
      pathToFileURL(join(REPO_ROOT, '.husky', 'lint-scope.mjs')).href
    )) as Record<string, unknown>;
    const derive = rule.deriveScopeDirs as (files: string[]) => string[];
    const shadowDirs = rule.shadowScopeDirs as (files: string[]) => string[];
    const gated = ['packages/z/src/a.ts', 'src/a.ts', 'packages/a/src/b.ts'];
    expect(derive(gated)).toEqual(derive([...gated].reverse()));
    expect(derive(gated)).toEqual(['packages/a/src', 'packages/z/src', 'src']);
    const shadow = ['tests/x.ts', 'scripts/y.mjs', 'packages/m/sub.ts'];
    expect(shadowDirs(shadow)).toEqual(shadowDirs([...shadow].reverse()));
  });
});

describe('Scenario: integration — the real generator run twice writes the same bytes', () => {
  it(
    '@slow seed, commit, then two runs of an unchanged tree agree on every byte but generatedAt',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const seeded = generatorRun(['--seed']);
      expect(seeded.code, seeded.stderr).toBe(0);
      fixture().commitAll('fixture: HEAD carries the artifact this tree measures');
      const run1 = generatorRun();
      equalRun = run1;
      const run2 = generatorRun();
      expect(run1.code, run1.stderr).toBe(0);
      expect(run2.code, run2.stderr).toBe(0);
      secondArtifact = run2.artifact;
      const moved = diffLines(run1.artifact, run2.artifact);
      expect(moved.length, moved.join('\n')).toBe(1);
      expect(moved[0]).toContain('"generatedAt"');
      expect(run1.artifact).not.toBe(run2.artifact);
    }
  );

  it(
    '@slow POSITIVE CONTROL: the double-run arm goes red on the one event it is about — an exempt file entering the index',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const run = equalRun;
      if (run === null) throw new Error('the equal run did not happen');
      fixture().addMainFile('tests/exempt-determinism.ts', FILE_SIZE_CAP_TESTS + 2);
      const after = generatorRun();
      run3 = after;
      expect(after.code, after.stderr).toBe(0);
      const moved = diffLines(secondArtifact, after.artifact);
      // Not one line any more: the shadow block moved, which is exactly what §2.46
      // left unobserved, and what the determinism claim must be able to see.
      expect(moved.length, moved.join('\n')).toBeGreaterThan(1);
      expect(moved.join('\n')).toContain('"measuredFiles"');
    }
  );
});

describe('Scenario: render — the risen block is a measured row, not a re-typed number', () => {
  it('@slow the exempt file that entered the index raised shadow.measuredFiles by exactly one', () => {
    const after = run3;
    if (after === null) throw new Error('the rise run did not happen');
    expect(Number(shadowOf(after.artifact).measuredFiles)).toBe(
      Number(shadowOf(secondArtifact).measuredFiles) + 1
    );
    expect(Object.keys(docOf(after.artifact))).toEqual(Object.keys(docOf(secondArtifact)));
    expect(Object.keys(docOf(after.artifact))).not.toContain('shadowMoveWarning');
  });

  it('@slow no ceiling row moved, because the file that arrived is exempt', () => {
    const after = run3;
    if (after === null) throw new Error('the rise run did not happen');
    expect(docOf(after.artifact).ceilings).toEqual(docOf(secondArtifact).ceilings);
  });
});

describe('Scenario: a11y — the rise says so out loud and the exit code is the unchanged one', () => {
  it('@slow §2.46: the rise run prints the warning and exits exactly as the equal run did', () => {
    const after = run3;
    const equal = equalRun;
    if (after === null || equal === null) throw new Error('the equal/rise runs did not happen');
    expect(riseLines(after.stderr).length).toBeGreaterThan(0);
    expect(after.stderr).toContain('the boundary exempts it; nobody fixed it');
    expect(after.code, after.stderr).toBe(equal.code);
    expect(after.code).toBe(0);
    expect(after.stdout).not.toContain('shadow moved up');
  });

  it('@slow once HEAD carries the risen block, the same tree is equal and warns about nothing', () => {
    fixture().commitAll('fixture: HEAD carries the risen shadow block');
    const run = generatorRun();
    expect(run.code, run.stderr).toBe(0);
    expect(run.stderr).toContain('shadow unchanged');
    expect(riseLines(run.stderr).length).toBe(0);
  });
});
