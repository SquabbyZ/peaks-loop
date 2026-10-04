// tests/unit/lint/baseline-monotonicity-seeding.test.ts
//
// Rid 2026-10-02-added-row-seeding-path (backlog §2.35). Repair cycle 1 (§2.33)
// anchored the ratchet's "previous" in `git show HEAD:.peaks/lint/gate-baseline.json`
// and added a second trip on the artifact on disk. That trip refused ANY working-copy
// difference from the anchor except a lowering — including an `ADDED` row the
// generator itself legitimately measured and wrote on the previous run. Measured
// consequence: a slice that introduces a ceiling row can regenerate ONCE, and the
// second regeneration before its commit refuses with a remedy — `git checkout HEAD --
// .peaks/lint/gate-baseline.json` — that would delete the row it is refusing.
//
// WHAT THIS FILE PINS. The trip is split by what the MEASUREMENT thinks. A lifted or
// dropped row is an attack whatever this run goes on to measure, so it still refuses
// immediately and before the expensive legs (`S6` proves the ordering with a marker the
// eslint leg writes, rather than by asserting that the code above it comes first). An
// `ADDED`-only difference is deferred and settled after the measurement: same value →
// seeded and said out loud; no value at all → a hand-typed row, refused, and the ONLY
// place restore advice belongs; a different value → refused naming both, because the
// measurement decides the number.
//
// WHY `S3` IS HERE AND NOT ONLY NEXT DOOR. `baseline-monotonicity-head-anchor.test.ts`
// owns §2.33's attacks. A change that lets a legitimately seeded row through is exactly
// the change that could let a hand-typed one through with it, so the three attacks are
// re-pinned against THIS fixture, in the presence of a fourteenth canonical row, with
// the artifact bytes asserted untouched. Re-pinning them is not a duplicate of that
// file's subject: the inputs differ (an anchor that is short of one canonical row), and
// that is the shape the deferral had to stay sound inside.
//
// THE FOURTEENTH KEY IS PATCHED INTO THE FIXTURE'S OWN COPIES. A slice that introduces
// a ceiling row edits `CEILING_KEYS` and the generator's `ceilings` object in the same
// change, so that is what `patchCanonicalList()` and `patchGeneratorRows()` do to the
// copies this fixture runs. The repository's real `CEILING_KEYS` is never touched: a
// fourteenth canonical key with thirteen rows in the published artifact would be the
// weakening this ratchet exists to refuse, and arm C1 of
// `baseline-monotonicity.test.ts` would (rightly) redden on it.
//
// Dimensions:
//   - integration: the real generator as a subprocess in a real git fixture, the
//                  artifact bytes before and after, and whether the measurement ran
//   - render:      the lines a permitted deferral and a permitted lowering print
//   - a11y:        the exit code and the sentence: which rows are named, both numbers,
//                  and the presence or absence of the restore instruction
//   - behavior:    omitted — the pure decision table and the canonical-key audit are
//                  asserted in `baseline-monotonicity.test.ts`

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import { REPO_ROOT, generatorCeilingsFileUnder } from '../standards/_file-size-cap-scan.js';
import { TSX_TOOL_STUB } from './_file-size-hooks-walk.js';
import { hooksScopeFilesUnder } from './_file-size-hooks-fixture.js';
import { ceilingKeyListFileUnder } from './_monotonic-module-set.js';

declareDimensions(
  'tests/unit/lint/baseline-monotonicity-seeding.test.ts',
  ['integration', 'render', 'a11y'],
  [
    {
      dim: 'behavior',
      reason: 'the pure decision table is asserted in baseline-monotonicity.test.ts'
    }
  ]
);

const GENERATOR = join('.husky', 'peaks-gate-baseline.mjs');
const ARTIFACT_REL = join('.peaks', 'lint', 'gate-baseline.json');
const ARTIFACT_GIT_PATH = '.peaks/lint/gate-baseline.json';
const SEED_FLAG = '--seed';
const RAISED_KEY = 'prettierUnformatted';
const DROPPED_KEY = 'silentWarningEmptyCatch';
const LOWERED_KEY = 'fileSizeExcessLines';
/** The row this fixture's own slice introduces: canonical, measured, absent from HEAD. */
const EXTRA_KEY = 'fixtureSeededRow';
/** A row no list carries and no leg measures: the hand-typed shape. */
const TYPED_KEY = 'rowNobodyMeasures';
const NO_ARTIFACT = '<no artifact on disk>';
/** Written by the fixture's eslint leg, so an arm can see whether it was ever spawned. */
const MARKER = '.measurement-ran';

const SCRATCH = mkdtempSync(join(tmpdir(), 'peaks-baseline-seeding-'));
const FIXTURE = join(SCRATCH, 'repo');
const ARTIFACT = join(FIXTURE, ARTIFACT_REL);

/** The leg that leaves the trace: an eslint run means the measurement started. */
const ESLINT_STUB =
  "require('node:fs').appendFileSync('.measurement-ran', 'eslint\\n');\n" +
  "process.stdout.write('[]\\n');\n";
const TSC_STUB = "process.stdout.write('');\n";
const DETECTOR_STUB =
  "const p = process.argv.slice(2).filter((a) => !a.startsWith('-'));\nconsole.log(JSON.stringify({ scannedFiles: p.length || 3, byRule: { 'catch-return-null': 1, 'empty-catch': 2 } }));\n";
// The census and comment-hygiene envelopes both come from `TSX_TOOL_STUB`: the two legs
// share one tsx spawn, and a stub that answered both with the census envelope left the
// comment rows without a count to seed.
const PRETTIER_PACKAGE =
  '{"name":"prettier","version":"0.0.0-fixture","type":"module","exports":{".":"./index.mjs"}}\n';

const GIT_NEUTRAL_ARGS: Record<string, string> = {
  'user.name': 'peaks-fixture',
  'user.email': 'peaks-fixture@invalid.invalid',
  'commit.gpgsign': 'false',
  'core.hooksPath': '.git/hooks',
  'core.autocrlf': 'false'
};
const GIT_NEUTRAL = Object.entries(GIT_NEUTRAL_ARGS).flatMap(([key, value]) => [
  '-c',
  `${key}=${value}`
]);

type Ceilings = Record<string, number>;
type ArtifactShape = { ceilings: Ceilings };
type GeneratorRun = { code: number; out: string; artifact: string };

function writeFixtureFile(relative: string, text: string): string {
  const abs = join(FIXTURE, relative);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text, 'utf8');
  return abs;
}

/** The same file as HEAD holds it — read the way `.husky/peaks-gate-baseline.mjs` reads it. */
function readRepoFile(relative: string): string {
  return readFileSync(join(REPO_ROOT, relative), 'utf8');
}

/**
 * The slice that adds a ceiling row lands the key in BOTH places at once — the
 * canonical list and the generator's assembled rows — and that is the change
 * `patchCanonicalList()` and `patchGeneratorRows()` make to the fixture's own copies.
 * Each patch asserts it fired: a replacement that silently matched nothing would leave
 * the arm measuring a thirteen-row generator and calling the row seeded.
 */
/** How many rows the canonical list in a copy of the module actually carries. */
function ceilingKeyRows(text: string): number {
  const list = /Object\.freeze\(\[([\s\S]*?)\]\);/.exec(text);
  const rows = list === null ? null : list[1];
  if (typeof rows !== 'string') {
    throw new Error('CEILING_KEYS must stay an Object.freeze([...]) literal');
  }
  return rows.split(',').filter((row) => row.trim() !== '').length;
}

function patchCanonicalList(text: string): string {
  const appendKey = (_m: string, row: string, eol: string, close: string) =>
    `${row},${eol}  '${EXTRA_KEY}'${eol}${close}`;
  const patched = text.replace(/( +'fileSizeExcessLines')(\r?\n)(\]\);)/, appendKey);
  expect(patched, 'the fixture must add a fourteenth key to CEILING_KEYS').not.toBe(text);
  expect(ceilingKeyRows(patched), 'the patched list is one row longer, not a corrupted one').toBe(
    ceilingKeyRows(text) + 1
  );
  return patched;
}

/** The fourteenth row's value is MEASURED (`notLinted.length`), never typed. */
function patchGeneratorRows(text: string): string {
  const appendRow = (_m: string, indRow: string, eol: string, close: string) => {
    const ind = /^[\t ]*/.exec(indRow)?.[0] ?? '';
    return `${indRow},${eol}${ind}  ${EXTRA_KEY}: notLinted.length${eol}${ind}${close}`;
  };
  const anchor = /^([ \t]*fileSizeExcessLines: size\.env\.excessLines)(\r?\n)([ \t]*\};)/m;
  const patched = text.replace(anchor, appendRow);
  expect(patched, 'the fixture must assemble the fourteenth row').not.toBe(text);
  expect(patched).toMatch(new RegExp(`^\\s+${EXTRA_KEY}: notLinted\\.length\\r?\\n\\s*\\};`, 'm'));
  return patched;
}

function gitInFixture(args: readonly string[]): void {
  execFileSync('git', args, {
    cwd: FIXTURE,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore']
  });
}

function commitFixture(message: string): void {
  gitInFixture([...GIT_NEUTRAL, 'commit', '-q', '--allow-empty', '-m', message]);
}

/** The fixture's prettier is the repository's real one, so the verdict is real. */
function prettierShim(): string {
  const real = pathToFileURL(join(REPO_ROOT, 'node_modules', 'prettier', 'index.mjs')).href;
  return `export { default } from '${real}';\nexport * from '${real}';\n`;
}

let fixtureBuilt = false;

/** A two-source-file repository whose HEAD commit carries NO baseline artifact. */
function buildFixture(): void {
  if (fixtureBuilt) return;
  fixtureBuilt = true;
  const declaredPrettier = (
    JSON.parse(readRepoFile('package.json')) as { prettier: Record<string, unknown> }
  ).prettier;
  writeFixtureFile(
    'package.json',
    `${JSON.stringify(
      { name: 'peaks-seeding-fixture', version: '0.0.0', prettier: declaredPrettier },
      null,
      2
    )}\n`
  );
  writeFixtureFile('src/lumpy.ts', 'export const   unformatted=1;\n');
  writeFixtureFile('src/tidy.ts', 'export const tidy = 1;\n');
  writeFixtureFile('scripts/lint/silent-warning-detector.mjs', DETECTOR_STUB);
  writeFixtureFile('node_modules/eslint/bin/eslint.js', ESLINT_STUB);
  writeFixtureFile('node_modules/typescript/bin/tsc', TSC_STUB);
  writeFixtureFile('node_modules/tsx/dist/cli.mjs', TSX_TOOL_STUB);
  writeFixtureFile('node_modules/prettier/package.json', PRETTIER_PACKAGE);
  writeFixtureFile('node_modules/prettier/index.mjs', prettierShim());
  const keysRel = ceilingKeyListFileUnder(REPO_ROOT);
  const rowsRel = generatorCeilingsFileUnder(REPO_ROOT);
  writeFixtureFile(keysRel, patchCanonicalList(readRepoFile(keysRel)));
  writeFixtureFile(rowsRel, patchGeneratorRows(readRepoFile(rowsRel)));
  for (const relative of hooksScopeFilesUnder(REPO_ROOT)) {
    if (relative === keysRel || relative === rowsRel) continue;
    writeFixtureFile(relative, readRepoFile(relative));
  }
  gitInFixture(['init', '-q']);
  gitInFixture(['add', '-A']);
  commitFixture('fixture: source and a fourteen-key generator, no artifact in HEAD');
}

function runGenerator(argv: readonly string[] = []): GeneratorRun {
  buildFixture();
  const spawned = spawnSync(process.execPath, [GENERATOR, ...argv], {
    cwd: FIXTURE,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024
  });
  if (spawned.error !== undefined) throw spawned.error;
  return {
    code: spawned.status ?? 1,
    out: `${spawned.stdout ?? ''}${spawned.stderr ?? ''}`,
    artifact: existsSync(ARTIFACT) ? readFileSync(ARTIFACT, 'utf8') : NO_ARTIFACT
  };
}

function artifactText(ceilings: Ceilings): string {
  return `${JSON.stringify({ version: 3, ceilings }, null, 2)}\n`;
}

/** Move the anchor: write the artifact AND commit it, so HEAD is what says X. */
function anchorHeadAt(ceilings: Ceilings): string {
  buildFixture();
  const text = artifactText(ceilings);
  writeFixtureFile(ARTIFACT_REL, text);
  gitInFixture(['add', '-A', ARTIFACT_GIT_PATH]);
  commitFixture('fixture: HEAD carries the anchor');
  return text;
}

/** Edit only the working copy — the move every attack and every seeded row made. */
function editWorkingCopy(ceilings: Ceilings): string {
  buildFixture();
  const text = artifactText(ceilings);
  writeFixtureFile(ARTIFACT_REL, text);
  return text;
}

let measured: Ceilings | null = null;

/** The fixture's own fourteen rows, learned from a seed run into an empty HEAD. */
function measuredCeilings(): Ceilings {
  if (measured === null) {
    buildFixture();
    rmSync(ARTIFACT, { force: true });
    const seeded = runGenerator([SEED_FLAG]);
    if (seeded.code !== 0 || seeded.artifact === NO_ARTIFACT) {
      throw new Error(`the fixture seed run must write: exit ${seeded.code}\n${seeded.out}`);
    }
    measured = (JSON.parse(seeded.artifact) as ArtifactShape).ceilings;
    expect(Object.keys(measured), 'the patched generator measures the fourteenth row').toContain(
      EXTRA_KEY
    );
    rmSync(ARTIFACT, { force: true });
    rmSync(join(FIXTURE, MARKER), { force: true });
  }
  return measured;
}

function ceilingsLike(overrides: Ceilings = {}, dropped: readonly string[] = []): Ceilings {
  const merged: Record<string, number | undefined> = { ...measuredCeilings(), ...overrides };
  for (const key of dropped) delete merged[key];
  return Object.fromEntries(
    Object.entries(merged).filter((entry) => entry[1] !== undefined)
  ) as Ceilings;
}

function ceilingOf(ceilings: Ceilings, key: string): number {
  const value = ceilings[key];
  if (typeof value !== 'number') throw new Error(`the fixture measured no ceiling at "${key}"`);
  return value;
}

function writtenCeilings(text: string): Ceilings {
  return (JSON.parse(text) as ArtifactShape).ceilings;
}

/** Exit 1, no bytes moved — the sentence the operator needs is asserted per arm. */
function expectRefusal(run: GeneratorRun, bytes: string, why: string): void {
  expect(run.code, `${why}\n${run.out}`).toBe(1);
  expect(run.out, why).toContain('REFUSING to write');
  expect(run.artifact, `${why}: a refused run must not move the artifact bytes`).toBe(bytes);
}

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

describe('Scenario: integration — regenerating twice is not a weakening', () => {
  it(
    'S1/S2 — when a slice adds a fourteenth canonical row, should seed it on the first run and keep seeding it on the second and third',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const extra = ceilingOf(measuredCeilings(), EXTRA_KEY);
      // HEAD carries thirteen rows; the artifact on disk carries the same thirteen.
      anchorHeadAt(ceilingsLike({}, [EXTRA_KEY]));
      rmSync(join(FIXTURE, MARKER), { force: true });

      const first = runGenerator();
      expect(first.code, first.out).toBe(0);
      expect(first.out).toContain('NEWLY SEEDED');
      expect(first.out).toContain(EXTRA_KEY);
      const seeded = JSON.stringify(writtenCeilings(first.artifact));
      expect(ceilingOf(writtenCeilings(first.artifact), EXTRA_KEY)).toBe(extra);

      // The defect: this run used to refuse, because the disk now carries a row HEAD
      // does not, and the remedy it printed would have deleted the row above.
      const second = runGenerator();
      expect(second.code, second.out).toBe(0);
      expect(second.out, second.out).not.toContain('REFUSING');
      expect(JSON.stringify(writtenCeilings(second.artifact))).toBe(seeded);
      expect(second.out, 'the row stays labelled seeded, never silently present').toContain(
        'NEWLY SEEDED'
      );
      expect(second.out).toMatch(/measures the same number/);
      expect(second.out, 'a permitted path prints no restore advice').not.toMatch(
        /git checkout HEAD/
      );

      const third = runGenerator();
      expect(third.code, third.out).toBe(0);
      expect(JSON.stringify(writtenCeilings(third.artifact))).toBe(seeded);
    }
  );

  it(
    'S3 — when the working copy deletes a row, lifts a row or empties the ceilings block, should still refuse all three attacks with the bytes untouched',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const held = ceilingOf(measuredCeilings(), RAISED_KEY);
      anchorHeadAt(ceilingsLike({}));
      const attacks: Array<[string, Ceilings, RegExp]> = [
        ['deletes a row', ceilingsLike({}, [DROPPED_KEY]), /DROPPED/],
        ['lifts a row', ceilingsLike({ [RAISED_KEY]: held + 1 }), /LIFTED/],
        ['empties the ceilings block', {}, /DROPPED/]
      ];
      for (const [name, vector, shape] of attacks) {
        const attacked = editWorkingCopy(vector);
        const run = runGenerator();
        expectRefusal(run, attacked, `the attack that ${name}`);
        expect(run.out, name).toMatch(shape);
        expect(run.out, `an attack is never a seeding: ${name}`).not.toContain('NEWLY SEEDED');
        expect(run.out, name).toMatch(/git checkout HEAD/);
      }
    }
  );

  it(
    'S6 — when the disk lifts or drops a row, should refuse before the measurement is spawned, and only reach the measurement for a deferred added row',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const raised = ceilingOf(measuredCeilings(), RAISED_KEY);
      anchorHeadAt(ceilingsLike({}));
      for (const [name, vector] of [
        ['lifts a row', ceilingsLike({ [RAISED_KEY]: raised + 1 })],
        ['drops a row', ceilingsLike({}, [DROPPED_KEY])]
      ] as Array<[string, Ceilings]>) {
        rmSync(join(FIXTURE, MARKER), { force: true });
        const attacked = editWorkingCopy(vector);
        const run = runGenerator();
        expectRefusal(run, attacked, `the edit that ${name}`);
        expect(
          existsSync(join(FIXTURE, MARKER)),
          `the refusal must land before the eslint leg runs, so ${name} costs no measurement`
        ).toBe(false);
      }

      // The same fixture with the deferred difference: there is no verdict without the
      // measurement, so the measurement has to run, and the row is seeded.
      anchorHeadAt(ceilingsLike({}, [EXTRA_KEY]));
      rmSync(join(FIXTURE, MARKER), { force: true });
      editWorkingCopy(ceilingsLike({}));
      const deferred = runGenerator();
      expect(deferred.code, deferred.out).toBe(0);
      expect(
        existsSync(join(FIXTURE, MARKER)),
        'an ADDED-only difference is settled by the measurement, so it must run'
      ).toBe(true);
    }
  );
});

describe('Scenario: a11y — the remedy matches the diagnosis, or it teaches people to delete debt', () => {
  it(
    'S4a — when the disk carries a row no list sanctions and no leg measures, should refuse it as hand-typed, once, with the restore advice, and under --seed too',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      anchorHeadAt(ceilingsLike({}, [EXTRA_KEY]));
      // The disk carries BOTH the row this run legitimately measures and one it does
      // not, so the arm also pins that the deferral refuses the typed row, not the
      // seeded one. `--seed` is the statement that a baseline is MISSING, never
      // permission to write over an edited one, so it must clear nothing here.
      const attacked = editWorkingCopy(ceilingsLike({ [TYPED_KEY]: 7 }));
      for (const argv of [[], [SEED_FLAG]]) {
        const run = runGenerator(argv);
        expectRefusal(run, attacked, `a row nobody measures, argv ${JSON.stringify(argv)}`);
        expect(run.out).toContain(TYPED_KEY);
        expect(run.out).toMatch(/NOT MEASURED|hand-typed/i);
        expect(run.out, 'the anchor really is wrong here, so saying so is the remedy').toContain(
          'git checkout HEAD'
        );
        expect(run.out, 'the row this run does measure is not refused with it').not.toContain(
          EXTRA_KEY
        );
        const named = run.out.split(TYPED_KEY).length - 1;
        expect(named, `one row, one verdict, not two overlapping ones:\n${run.out}`).toBe(1);
        expect(run.out).toContain('Nothing has been written');
      }
    }
  );

  it(
    'S4b — when the disk carries the seeded row at a number this run does not measure, should refuse naming both values and print no restore advice at all',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const extra = ceilingOf(measuredCeilings(), EXTRA_KEY);
      const typedHigher = extra + 5;
      anchorHeadAt(ceilingsLike({}, [EXTRA_KEY]));
      const attacked = editWorkingCopy(ceilingsLike({ [EXTRA_KEY]: typedHigher }));
      const run = runGenerator();
      expectRefusal(run, attacked, 'the disk number is not the measured number');
      expect(run.out).toContain(EXTRA_KEY);
      expect(run.out, 'both sides, or the operator cannot tell which is which').toMatch(
        new RegExp(`${EXTRA_KEY}[^\\n]*disk ${typedHigher}`)
      );
      expect(run.out).toMatch(new RegExp(`measured by this run ${extra}`));
      expect(run.out).toMatch(/measurement decides/);
      expect(
        run.out,
        `a row this run measures is real debt; restore advice would delete it:\n${run.out}`
      ).not.toMatch(/git checkout|restor/i);
    }
  );
});

describe('Scenario: render — what the paths that are not refusals print', () => {
  it(
    'S5 — when the disk equals the anchor, should write quietly with no seeding note at all',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      anchorHeadAt(ceilingsLike({}));
      const run = runGenerator();
      expect(run.code, run.out).toBe(0);
      expect(run.out, run.out).not.toContain('REFUSING');
      expect(run.out).not.toMatch(/SEEDED|seeded/i);
      expect(run.out).toContain('every ceiling held');
      expect(JSON.stringify(writtenCeilings(run.artifact))).toBe(
        JSON.stringify(measuredCeilings())
      );
    }
  );

  it(
    'S5 — when the disk only LOWERS a row, should name it as a stricter request and write the measurement anyway',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const held = ceilingOf(measuredCeilings(), LOWERED_KEY);
      anchorHeadAt(ceilingsLike({}));
      editWorkingCopy(ceilingsLike({ [LOWERED_KEY]: 0 }));
      const run = runGenerator();
      expect(run.code, run.out).toBe(0);
      expect(run.out, run.out).not.toContain('REFUSING');
      expect(run.out).toMatch(/LOWER than/);
      expect(ceilingOf(writtenCeilings(run.artifact), LOWERED_KEY)).toBe(held);
      expect(run.out).not.toMatch(/SEEDED/);
    }
  );
});
