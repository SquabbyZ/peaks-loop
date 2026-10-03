// tests/unit/lint/baseline-rescope-guard.test.ts
//
// Rid `2026-10-03-w10-rescope-a` H1 + H3, at process level. The monotonicity
// guard compared VALUES and knew nothing about the SCOPE that produced them:
// narrowing the enforced file set lets one regeneration report
// `eslintFindings 2768 → 2130` — a 638-finding improvement nobody made — and
// re-anchor to the smaller number (backlog §2.42, the §2.27 laundering door
// through a new frame). THIS file runs the REAL generator in a REAL fixture
// repository and answers the three questions the brief names:
//
//   1. HEAD's artifact carries the WIDE scope and the run has NO flag →
//      exit non-zero, the refusal names both dir lists, both measured-file
//      counts and every row it is about to hide, says "scope change, not a
//      reduction in debt", and the artifact bytes are untouched. (The brief's
//      positive control: without this arm the whole section is prose.)
//   2. The same state WITH `--rescope` → exit 0, and the out-of-scope totals
//      land in the artifact as `shadow.*` — measured, reported, and NOT in
//      `CEILING_KEYS` — plus the one prescribed stderr line.
//   3. `--rescope` passed when nothing rescoped → exit 1, "nothing to
//      rescope": the flag is required, not cosmetic. A plain run right after
//      it exits 0 anyway, so arm 3 refuses for the flag, not for the state.
//
// Fixture posture shared with `baseline-monotonicity-generator.test.ts`:
// eslint/tsc/detector stubbed, prettier and the CENSUS real (the fixture's tsx
// forwards to the repository's), everything under `mkdtempSync`, nothing
// written into this repository. The shadow over-cap file is REAL (written at
// tests-cap + 3 raw lines) so the refusal names a delta the census measured,
// not a number a stub invented.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import { FILE_SIZE_CAP_TESTS } from '../../../src/services/scan/file-size-policy.js';
import { createFixture, fileOf, type Fixture } from './_file-size-hooks-fixture.js';

declareDimensions(
  'tests/unit/lint/baseline-rescope-guard.test.ts',
  ['integration', 'render', 'a11y'],
  [
    {
      dim: 'behavior',
      reason: 'the pure trip functions ride these process arms; a text pin could not show the write actually stopping'
    }
  ]
);

const GENERATOR_REL = join('.husky', 'peaks-gate-baseline.mjs');
const ARTIFACT_REL = join('.peaks', 'lint', 'gate-baseline.json');
const WIDE_DIRS = ['src', 'tests', 'packages', 'scripts'];

let fx: Fixture | null = null;
function fixture(): Fixture {
  if (fx === null) {
    fx = createFixture('rescope-guard');
    // One out-of-gated-scope file OVER the tests cap: the shadow census row is
    // then a real measured number, and the refusal has a genuine per-row delta
    // to name.
    fx.write(join('tests', 'big-shadow.ts'), fileOf(FILE_SIZE_CAP_TESTS + 3));
    fx.commitAll('fixture: a tracked tests/ file over the cap joins the shadow population');
  }
  return fx;
}

type Run = { code: number; out: string; artifact: string };

function run(argv: readonly string[]): Run {
  const f = fixture();
  const spawned = spawnSync(process.execPath, [GENERATOR_REL, ...argv], {
    cwd: f.root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024
  });
  if (spawned.error !== undefined) throw spawned.error;
  return {
    code: spawned.status ?? 1,
    out: `${spawned.stdout ?? ''}${spawned.stderr ?? ''}`,
    artifact: existsSync(f.artifactPath) ? readFileSync(f.artifactPath, 'utf8') : '<none>'
  };
}

function artifactText(): string {
  return readFileSync(fixture().artifactPath, 'utf8');
}

type ArtifactDoc = {
  scope: { dirs: string[] };
  ceilings: Record<string, number>;
  files: Record<string, unknown>;
  shadow?: Record<string, unknown>;
};

function artifact(): ArtifactDoc {
  return JSON.parse(artifactText()) as ArtifactDoc;
}

/** Rewrite the seeded artifact into one the OLD wide scope produced, and make HEAD say so. */
function widenHeadScopeAndCommit(): string {
  const f = fixture();
  const census = f.census();
  const doc = JSON.parse(artifactText()) as Record<string, unknown>;
  doc.scope = { ...(doc.scope as object), dirs: WIDE_DIRS };
  doc.ceilings = {
    ...(doc.ceilings as Record<string, number>),
    fileSizeOverCap: census.overCap,
    fileSizeExcessLines: census.excessLines
  };
  delete doc.shadow;
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  writeFileSync(f.artifactPath, text, 'utf8');
  f.commitAll('fixture: HEAD carries the wide-scope baseline');
  return text;
}

afterAll(() => {
  fx?.cleanup();
});

describe('Scenario: integration — H1: a rescope refuses by default and writes only with --rescope', () => {
  let wideBytes = '';

  it(
    'A1: with HEAD on the wide scope and NO flag, exits 1, names everything, and leaves the bytes untouched',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const seeded = run(['--seed']);
      expect(seeded.code, seeded.out).toBe(0);
      expect(artifact().scope.dirs, 'the rule, not the enumeration of the old dirs').not.toEqual(
        WIDE_DIRS
      );
      wideBytes = widenHeadScopeAndCommit();

      const refused = run([]);
      expect(refused.code, refused.out).toBe(1);
      expect(refused.out).toContain('REFUSING to write');
      expect(refused.out).toContain('SCOPE CHANGE');
      expect(refused.out).toContain('--rescope');
      expect(refused.out).toContain('not a reduction in debt');
      expect(refused.out).toContain(JSON.stringify(WIDE_DIRS));
      expect(refused.out).toContain('measured files');
      // The per-row delta the write was about to hide, named with its numbers.
      expect(refused.out).toMatch(/fileSizeOverCap: \d+ -> \d+/);
      expect(refused.out).toMatch(/measured files: \d+ -> \d+/);
      expect(refused.artifact, 'the refusal happens before any byte changes').toBe(wideBytes);
    }
  );

  it(
    'A2: the same state with --rescope exits 0 and carries the out-of-scope totals as shadow rows, not ceilings',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const written = run(['--rescope']);
      expect(written.code, written.out).toBe(0);
      expect(written.artifact).not.toBe(wideBytes);
      const doc = artifact();
      expect(doc.scope.dirs).not.toEqual(WIDE_DIRS);
      const census = fixture().census();
      const ceilingOf = (key: string): number => {
        const value = doc.ceilings[key];
        if (typeof value !== 'number') throw new Error(`no numeric ceiling at ${key}`);
        return value;
      };
      // H3: measured, reported, NON-gated. The partition is against the real
      // census: universe minus the gated ceiling rows the artifact now holds.
      expect(doc.shadow, 'the shadow block exists').toBeDefined();
      const shadow = doc.shadow as Record<string, unknown>;
      const shadowNum = (key: string): number => {
        const value = shadow[key];
        if (typeof value !== 'number') throw new Error(`no numeric shadow row at ${key}`);
        return value;
      };
      expect(shadowNum('measuredFiles')).toBeGreaterThan(0);
      expect(shadowNum('eslintFindings')).toBeTypeOf('number');
      expect(shadowNum('eslintErrors')).toBeTypeOf('number');
      expect(shadowNum('fileSizeOverCap')).toBe(census.overCap - ceilingOf('fileSizeOverCap'));
      expect(shadowNum('fileSizeExcessLines')).toBe(
        census.excessLines - ceilingOf('fileSizeExcessLines')
      );
      expect(shadowNum('fileSizeOverCap')).toBeGreaterThan(0);
      expect(shadow.scopeDirs).toEqual(expect.arrayContaining(['tests', 'scripts']));
      expect(Object.keys(shadow).sort()).toEqual(
        [
          'eslintErrors',
          'eslintFindings',
          'fileSizeExcessLines',
          'fileSizeOverCap',
          'measuredFiles',
          'scopeDirs'
        ].sort()
      );
      expect(Object.keys(doc.ceilings)).not.toContain('shadow');
      // The prescribed stderr line, with this run's real numbers.
      expect(written.out).toContain(
        `out-of-scope (not gated, owner decision 2026-10-03): ${String(shadow.measuredFiles)} files, ` +
          `${String(shadow.eslintFindings)} findings, ${String(shadow.fileSizeExcessLines)} excess lines`
      );
      fixture().commitAll('fixture: HEAD now carries the narrow scope');
    }
  );
});

describe('Scenario: a11y — the flag is required, not cosmetic', () => {
  it(
    'A3: --rescope with the scope unchanged since HEAD refuses, naming the nothing-to-rescope reason',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const before = artifactText();
      const refused = run(['--rescope']);
      expect(refused.code, refused.out).toBe(1);
      expect(refused.out).toContain('REFUSING to write');
      expect(refused.out).toContain('nothing to rescope');
      expect(readFileSync(fixture().artifactPath, 'utf8')).toBe(before);
    }
  );

  it(
    'A3 control: the same state WITHOUT the flag is a plain permitted regeneration',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const ok = run([]);
      expect(ok.code, ok.out).toBe(0);
      expect(ok.out).not.toContain('REFUSING');
    }
  );
});
