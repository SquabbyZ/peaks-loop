// tests/unit/lint/silent-warning-scope-leg.test.ts
//
// Rid `2026-10-03-silent-warning-scope` D1 — the silent-warning leg must measure
// the same tracked population every other enforced leg measures (backlog §2.43).
//
// THE DEFECT. `scripts/lint/silent-warning-detector.mjs:45` hardcoded
// `SCAN_ROOTS = ['src']`, so the two rows `silentWarningCatchReturnNull` /
// `silentWarningEmptyCatch` ratcheted 905 files while `eslintFindings`,
// `prettierUnformatted`, `fileSizeOverCap` and the hooks rows all ratchet the 943
// files `git ls-files` x the published scope names. The gate said this out loud
// rather than hiding it — `repo` mode printed `Recorded, not reconciled` — and
// what that footnote concealed was measurable: 17 real swallows in
// `packages/*/src`, never counted by anything (8 catch-return-null + 9
// empty-catch, 16 of them in one file).
//
// WHY THE ARMS ARE IN A FIXTURE AND NOT HERE. Every arm below plants debt and has
// to watch the REAL leg go red or green over it. Writing that debt into this
// repository would be writing debt into the ratchet (§2.31), so each arm builds a
// scratch repository with its own `git init` and installs the real detector over
// the harness's argv-blind stub (`_silent-warning-scope-fixture.ts` explains why a
// stub that ignores its arguments cannot witness a population claim).
//
// THE FOUR THINGS THESE ARMS PIN
//   1. COVERAGE: a swallow in a tracked `packages/*/src` file moves the row and the
//      seeded ceiling. This is the thing the slice buys, and it was blind before.
//   2. POPULATION HONESTY: an UNTRACKED scratch file under `src/` — the one class
//      the filesystem walk did see — moves nothing. The mirror of
//      `file-size-hooks-scope-leg.test.ts` for the leg that had no such arm.
//   3. THE EQUALITY IS A GATE, NOT A FOOTNOTE: a run whose detector scanned fewer
//      files than the enforced scope names (here: a tracked file the index still
//      lists and the disk no longer carries) refuses, exit non-zero, naming both
//      counts. Two numbers on one screen must be an error.
//   4. THE SENTENCE: `silent-warning: <N> file(s) scanned, == the enforced scope`
//      replaces the reconciled-or-not note, in both modes that speak for the rows.
//
// Dimensions:
//   - behavior:    what moving a file's tracked-ness does to the row
//   - integration: real fixture repository, real detector, real gate process
//   - render:      the two rows and the population sentence
//   - a11y:        the refusal text and the exit code of a disagreeing population

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import { REPO_ROOT } from '../standards/_file-size-cap-scan.js';
import { type Fixture } from './_file-size-hooks-fixture.js';
import {
  KEY_EMPTY,
  KEY_NULL,
  ROW_EMPTY,
  ROW_NULL,
  catchReturnNullSource,
  createDetectorFixture,
  detectorScan,
  emptyCatchSource,
  gatedFiles,
  recordedLegScope,
  rowFor,
  runRepoMode,
  runSilentWarningLeg
} from './_silent-warning-scope-fixture.js';

declareDimensions(
  'tests/unit/lint/silent-warning-scope-leg.test.ts',
  ['behavior', 'integration', 'render', 'a11y'],
  []
);

const DEBT_REL = 'packages/pk/src/debt.ts';
const TIDY_REL = join('src', 'tidy.ts');
const TIDY_TEXT = 'export const tidy = 1;\n';
/** The untracked scratch file arm 2 plants under `src/`, and removes. */
const SCRATCH_REL = join('src', 'untracked-scratch.ts');

/**
 * The fixture's enforced scope, MEASURED in `beforeAll` — `git ls-files` filtered by
 * the published rule, exactly as the gate filters it. Every population assertion
 * below reads this list rather than a literal, so the arm fails when the leg's count
 * disagrees with the scope's count instead of agreeing with a typed number.
 */
let GATED: string[] = [];
const populationLine = (scanned: number) => `${scanned} file(s) scanned, == the enforced scope`;

let fx: Fixture | null = null;
function fixture(): Fixture {
  if (fx === null) {
    fx = createDetectorFixture('scope');
    // One tracked `packages/*/src` file carrying ONE empty-catch swallow: the debt
    // the 905-file walk never saw. `catchReturnNullSource(2)` rides in the same
    // file so arm 1 can tell the two rows apart rather than one total.
    fx.write(DEBT_REL, `${emptyCatchSource(1)}${catchReturnNullSource(2)}`);
    fx.commitAll('fixture: one package src file with 1 empty-catch and 2 return-null swallows');
  }
  return fx;
}

function ceilings(): Record<string, unknown> {
  const doc = JSON.parse(readFileSync(fixture().artifactPath, 'utf8')) as {
    ceilings: Record<string, unknown>;
  };
  return doc.ceilings;
}

function ceilingOf(key: string): number {
  const value = ceilings()[key];
  if (!Number.isInteger(value)) {
    throw new Error(`the fixture artifact carries no integer ceiling at ${key}`);
  }
  return value as number;
}

afterAll(() => {
  fx?.cleanup();
});

beforeAll(async () => {
  // One seed for the whole file: the ceilings this fixture writes are the numbers
  // its own measurement produced, so no arm below types a debt figure.
  const seed = fixture().runGenerator(['--seed']);
  expect(seed.code, seed.out).toBe(0);
  GATED = await gatedFiles(fixture());
  expect(GATED, 'the planted package file is inside the enforced scope').toContain(DEBT_REL);
});

describe('Scenario: integration — the leg measures the tracked scope, not its own walk', () => {
  it(
    'A1: a tracked packages/*/src swallow moves both the seeded ceiling and the leg row',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: the fixture's own detector, asked directly over the enforced scope.
      //        This is the independent reading, not the leg's number restated.
      const direct = detectorScan(fixture(), GATED);
      expect(direct.scannedFiles, 'the scope list is the population').toBe(GATED.length);
      // …and over the planted file alone, so the number the next two assertions share
      // is the package file's own debt: 1 empty-catch + 2 return-null. Before this
      // slice the generator seeded BOTH rows from a `src/` walk that never opened
      // this file, and both ceilings sat below what the scope actually holds.
      const planted = detectorScan(fixture(), [DEBT_REL]);
      expect(planted.byRule['empty-catch'] ?? 0).toBe(1);
      expect(planted.byRule['catch-return-null'] ?? 0).toBe(2);

      // when: the generator seeds from the scope-wide measurement
      // then: each ceiling IS that measurement, and it is at least the planted
      //       package file's own debt — the debt the old `src/` walk could not have
      //       reached, which is why both rows seeded below what the scope holds.
      expect(ceilingOf(KEY_EMPTY), 'the empty-catch ceiling is the measured count').toBe(
        direct.byRule['empty-catch'] ?? 0
      );
      expect(ceilingOf(KEY_NULL), 'the return-null ceiling is the measured count').toBe(
        direct.byRule['catch-return-null'] ?? 0
      );
      expect(direct.byRule['empty-catch'] ?? 0).toBeGreaterThanOrEqual(1);
      expect(direct.byRule['catch-return-null'] ?? 0).toBeGreaterThanOrEqual(2);

      // and: the leg, run whole-scope the way `repo` mode runs it, says the same.
      const run = runSilentWarningLeg(fixture());
      expect(rowFor(run.out, ROW_EMPTY).actual, run.out).toBe(direct.byRule['empty-catch'] ?? 0);
      expect(rowFor(run.out, ROW_NULL).actual, run.out).toBe(
        direct.byRule['catch-return-null'] ?? 0
      );
      expect(run.out, run.out).toContain(populationLine(GATED.length));
      expect(run.code, run.out).toBe(0);
    }
  );

  it(
    'A2: an UNTRACKED scratch file under src/ moves neither row and neither population',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a file on disk that the index has never seen — the class a
      //        filesystem walk reads and `git ls-files` refuses. It carries FOUR
      //        swallows so a leg that still walked would move by a visible margin.
      const before = detectorScan(fixture(), GATED);
      const abs = join(fixture().root, SCRATCH_REL);
      writeFileSync(abs, emptyCatchSource(4), 'utf8');
      try {
        const run = runSilentWarningLeg(fixture());
        expect(rowFor(run.out, ROW_EMPTY).actual, run.out).toBe(before.byRule['empty-catch'] ?? 0);
        expect(rowFor(run.out, ROW_NULL).actual, run.out).toBe(
          before.byRule['catch-return-null'] ?? 0
        );
        expect(run.out, run.out).toContain(populationLine(GATED.length));
        expect(run.code, run.out).toBe(0);
      } finally {
        rmSync(abs, { force: true });
      }
    }
  );

  it(
    'A3: the leg population is recorded in the artifact scope, named with its source',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // The ratchet's population becomes data in the artifact (§2.41: a count
      // without a source is a claim). `git ls-files` x the published scope is what
      // produced this run's number, and the record must name both the count and the
      // tool that counted — a per-leg record is METADATA inside `scope`, never a
      // sixteenth ceiling.
      const record = recordedLegScope(fixture(), 'silentWarning');
      expect(record, 'the scope block records the silent-warning population').not.toBeNull();
      expect(record?.scannedFiles, 'the recorded population is the enforced scope').toBe(
        GATED.length
      );
      expect(record?.source).toBe('git ls-files <scope dirs>');
      expect(Object.keys(ceilings())).not.toContain('silentWarning');
    }
  );
});

describe('Scenario: a11y — a disagreeing population refuses in words', () => {
  it(
    'A4: a tracked file the disk no longer carries makes the leg refuse, naming both counts',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a tracked deletion with no index entry — `git ls-files` still names
      //        the file, so the list the leg hands the detector is GATED.length and
      //        what the detector can read is one fewer. The stale index is not a
      //        hypothesis: §2.47 is this repository meeting it for real one slice ago.
      rmSync(join(fixture().root, TIDY_REL), { force: true });
      try {
        const run = runSilentWarningLeg(fixture());
        expect(run.code, run.out).not.toBe(0);
        expect(run.out, run.out).toContain('REFUSING to measure');
        expect(run.out, run.out).toContain('silent-warning');
        expect(run.out, run.out).toContain(
          `scanned ${String(GATED.length - 1)} file(s) of the ${String(GATED.length)}`
        );
        // A refusal prints no rows: no `✓` line a reader can mistake for a held ceiling.
        expect(run.out).not.toMatch(/(✓|✗) silent-warn/);
      } finally {
        writeFileSync(join(fixture().root, TIDY_REL), TIDY_TEXT, 'utf8');
      }
    }
  );
});

describe('Scenario: render — the equality is said out loud, in both modes', () => {
  it(
    'A5: silent-warning mode prints the population sentence and no footnote',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const run = runSilentWarningLeg(fixture());
      expect(run.out, run.out).toContain(populationLine(GATED.length));
      expect(run.out).not.toContain('Recorded, not reconciled');
      expect(run.out).not.toContain('its own');
    }
  );

  it(
    'A6: repo mode prints the same sentence, and its two numbers cannot disagree',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // `repo` mode is the enforcement surface and the footnote lived here: it
      // printed `905 of its own src/ walk, not the 943 files in this gate's scope`
      // and kept going. The line below is the same claim as A5's, from the process
      // that decides whether a push happens.
      const run = runRepoMode(fixture());
      expect(run.out, run.out).toContain(populationLine(GATED.length));
      expect(run.out).not.toContain('Recorded, not reconciled');
      expect(run.code, run.out).toBe(0);
    }
  );
});

describe('Scenario: behavior — the published artifact says the same thing about this repository', () => {
  it('A7: the recorded silent-warning population equals the list the gate lints', async () => {
    // Read-only against the real repository, and the arm that stays red until the
    // widened measurement has actually landed (D3): the published record and the
    // published scope are two numbers a reader must not have to reconcile.
    const fileListModule = (await import(
      pathToFileURL(join(REPO_ROOT, 'scripts', 'lint', 'lint-file-list.mjs')).href
    )) as { lintFileList(): string[] };
    const scope = (
      JSON.parse(readFileSync(join(REPO_ROOT, '.peaks', 'lint', 'gate-baseline.json'), 'utf8')) as {
        scope: Record<string, { scannedFiles?: number }>;
      }
    ).scope;
    const record = scope.silentWarning;
    expect(record, 'the published artifact records the leg population').toBeDefined();
    expect(record?.scannedFiles).toBe(fileListModule.lintFileList().length);
  });
});
