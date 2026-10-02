// tests/unit/lint/baseline-monotonicity-generator.test.ts
//
// Rid 2026-10-02-baseline-monotonicity (§2.27), the process half. The decision
// table itself is asserted arm by arm in
// `tests/unit/lint/baseline-monotonicity.test.ts`; THIS file answers the one
// question an in-process comparison cannot: does the generator really refuse
// BEFORE it writes?
//
// THE DEFECT, MEASURED 2026-10-01. C wave 7 staged 29 files of which seven were
// not prettier-formatted. `node .husky/peaks-gate-baseline.mjs` regenerated the
// artifact, raised `prettierUnformatted` 0 → 7, printed `wrote
// .peaks/lint/gate-baseline.json` and exited **0**. The generator never read its
// own output back, so there was no previous number to compare against — the
// ratchet moved up and the only thing that noticed was a human diffing the
// artifact key by key.
//
// WHY A FIXTURE REPOSITORY RATHER THAN A TEXT PIN. §4c of
// `.peaks/docs/lint-gate.md` is this repo's standing warning that a guard which
// reads source text sees shape, not behaviour. So nothing below greps the
// generator for the refusal: every arm RUNS it, in an OS-temp repository of its
// own, and reads the exit code, the log and the artifact BYTES.
//
// WHERE THIS FILE'S "PREVIOUS" LIVES — rid 2026-10-02-monotonicity-head-anchor.
// C wave 8 read the previous ceilings out of the working-tree artifact, and an
// out-of-band review measured three ways past it (delete a row → `NEWLY SEEDED`,
// inflate a row → `CLEARED`, `"ceilings": {}` → all thirteen re-seeded). The
// anchor moved to `git show HEAD:.peaks/lint/gate-baseline.json`, so
// `writePreviousArtifact()` below now writes the artifact AND COMMITS it: the
// previous side of every arm here is a git object. The attacks that edit only the
// working copy, the working-copy-vs-HEAD trip, the canonical key list and the
// two-run happy path are the subject of
// `tests/unit/lint/baseline-monotonicity-head-anchor.test.ts`.
//
// WHAT THE FIXTURE STUBS, AND WHAT IT DOES NOT
//   - Stubbed: eslint, tsc and the file-size census, so an arm costs a second
//     instead of the minutes the real measurement path costs. Each stub is named
//     where it is written, and the generator's own fail-closed trips still read
//     their envelopes, so a stub that stopped answering would abort the run
//     rather than quietly change a number.
//   - NOT stubbed: prettier. The fixture's `node_modules/prettier` re-exports the
//     repository's installed prettier, so `prettierUnformatted` is a real
//     formatting verdict on a real file — and the per-file `prettierClean` flags
//     the run writes are cross-checked, which is how an arm knows the raise it is
//     refusing was measured and not asserted.
//   - NOT stubbed: the comparison, the refusal, and the write. All three are the
//     generator's own code, copied in and executed.
//
// NO CEILING IS TYPED HERE. Every previous artifact is DERIVED from the fixture's
// own measurement by moving one key, so a re-seed moves the arms with it.
//
// NOTHING IS WRITTEN INTO THE REPOSITORY: the fixture lives under
// `mkdtempSync(join(tmpdir(), …))` and is removed in `afterAll` (backlog §2.31 —
// a wave committed five zero-byte captures because its scratch depended on cwd).
// The published `.peaks/lint/gate-baseline.json` is read, never written.
//
// Dimensions:
//   - integration: the real generator as a subprocess, the real prettier, the
//                  artifact bytes before and after
//   - render:      the lines a permitted write prints about the rows it moved
//   - a11y:        the exit code and the sentence an operator reads when the
//                  ratchet tries to move up
//   - behavior:    omitted — every row of the decision table is asserted on the
//                  pure comparison in the sibling file named above

import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import { hooksScopeFilesUnder } from './_file-size-hooks-fixture.js';

declareDimensions(
  'tests/unit/lint/baseline-monotonicity-generator.test.ts',
  ['integration', 'render', 'a11y'],
  [
    {
      dim: 'behavior',
      reason: 'the decision table is asserted on the pure comparison in the sibling file'
    }
  ]
);

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const GENERATOR = join('.husky', 'peaks-gate-baseline.mjs');
/**
 * Staged by WALK, not by name: a hand-named list is a second copy of the tree, and
 * every such list in this gate died with `ERR_MODULE_NOT_FOUND` inside the temp repo
 * the day an entry gained siblings (wave 7 `.husky/gate/`, this slice's
 * `.husky/monotonic/`). `hooksScopeFilesUnder` applies the census's own rule to the
 * real tree, so every module any entry imports is staged without an edit here.
 */
const GENERATOR_FILES = hooksScopeFilesUnder(REPO_ROOT);
const ARTIFACT_REL = join('.peaks', 'lint', 'gate-baseline.json');
const SEED_FLAG = '--seed';
/** The key 2026-10-01 moved (0 → 7). The fixture moves the same one. */
const RAISED_KEY = 'prettierUnformatted';
/** The sentinel for "there is no artifact here to compare bytes against". */
const NO_ARTIFACT = '<no artifact on disk>';

const SCRATCH = mkdtempSync(join(tmpdir(), 'peaks-baseline-monotonic-'));
const FIXTURE = join(SCRATCH, 'repo');
const ARTIFACT = join(FIXTURE, ARTIFACT_REL);

// ---------------------------------------------------------------------------
// The fixture repository
// ---------------------------------------------------------------------------

/** eslint reports nothing, so the six eslint rows are this fixture's own zeroes. */
const ESLINT_STUB = "process.stdout.write('[]\\n');\n";
/** tsc is silent, so `tscErrors` is 0 whatever the host's TypeScript costs. */
const TSC_STUB = "process.stdout.write('');\n";
/** The silent-warning detector's envelope, in the shape the generator parses. */
const DETECTOR_STUB =
  "console.log(JSON.stringify({ scannedFiles: 3, byRule: { 'catch-return-null': 1, 'empty-catch': 2 } }));\n";
/**
 * The census envelope, in the shape `.husky/peaks-gate-file-size.mjs` requires. Its
 * `scope.source` must be the whole-scope spelling or the generator refuses for a
 * reason that has nothing to do with this slice — which is the point of feeding it a
 * real envelope rather than a mock return value. The `hooks` block is the second
 * scope's census (§2.32): `hooksEnvelopeProblem` refuses an envelope without it, so a
 * fixture that stopped reporting it would be a fixture that measures nothing.
 */
const CENSUS_STUB =
  'process.stdout.write(JSON.stringify({ overCap: 1, excessLines: 9, ' +
  "convention: 'split(String.fromCharCode(10)).length', caps: { defaultCap: 300, testsCap: 500 }, " +
  "scope: { countedFiles: 3, source: 'git ls-files <policy dirs>', dirs: ['src'], " +
  "extensions: ['ts'] }, byDir: { src: { files: 3 } }, " +
  "hooks: { overCap: 1, excessLines: 4, caps: { hooksCap: 300 }, convention: 'split(String.fromCharCode(10)).length', scope: { countedFiles: 2, source: 'git ls-files <hooks dirs>', dirs: ['.husky'], extensions: ['mjs'] }, files: [] } }) + '\\n');\n";
const PRETTIER_PACKAGE =
  '{"name":"prettier","version":"0.0.0-fixture","type":"module","exports":{".":"./index.mjs"}}\n';

/**
 * The one part of the measurement path that is NOT a stub: the fixture's
 * `prettier` re-exports the repository's installed prettier, so
 * `prettierUnformatted` is a real formatting verdict on a real file.
 */
function prettierShim(): string {
  const real = pathToFileURL(join(REPO_ROOT, 'node_modules', 'prettier', 'index.mjs')).href;
  return `export { default } from '${real}';\nexport * from '${real}';\n`;
}

function writeFixtureFile(relative: string, text: string): string {
  const abs = join(FIXTURE, relative);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text, 'utf8');
  return abs;
}

function copyFixtureFile(relative: string): void {
  copyFileSync(join(REPO_ROOT, relative), writeFixtureFile(relative, ''));
}

function gitInFixture(args: readonly string[]): void {
  execFileSync('git', args, {
    cwd: FIXTURE,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore']
  });
}

/** The fixture commits with its own identity and its own (empty) hooks path. */
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

function commitFixture(message: string): void {
  gitInFixture([...GIT_NEUTRAL, 'commit', '-q', '--allow-empty', '-m', message]);
}

let fixtureBuilt = false;

/**
 * A repository small enough to measure in under a second, shaped like the
 * 2026-10-01 event: tracked source, one file prettier calls dirty, and an
 * artifact the generator reads back as "previous".
 */
function buildFixture(): void {
  if (fixtureBuilt) return;
  fixtureBuilt = true;
  const declaredPrettier = (
    JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      prettier: Record<string, unknown>;
    }
  ).prettier;
  writeFixtureFile(
    'package.json',
    `${JSON.stringify(
      { name: 'peaks-baseline-monotonicity-fixture', version: '0.0.0', prettier: declaredPrettier },
      null,
      2
    )}\n`
  );
  // Dirty on purpose: prettier collapses the run of spaces and adds the missing
  // ones around `=`. This is the seventh staged file of 2026-10-01.
  writeFixtureFile('src/lumpy.ts', 'export const   unformatted=1;\n');
  writeFixtureFile('src/tidy.ts', 'export const tidy = 1;\n');
  writeFixtureFile('scripts/lint/silent-warning-detector.mjs', DETECTOR_STUB);
  writeFixtureFile('node_modules/eslint/bin/eslint.js', ESLINT_STUB);
  writeFixtureFile('node_modules/typescript/bin/tsc', TSC_STUB);
  writeFixtureFile('node_modules/tsx/dist/cli.mjs', CENSUS_STUB);
  writeFixtureFile('node_modules/prettier/package.json', PRETTIER_PACKAGE);
  writeFixtureFile('node_modules/prettier/index.mjs', prettierShim());
  for (const relative of GENERATOR_FILES) {
    if (existsSync(join(REPO_ROOT, relative))) copyFixtureFile(relative);
  }
  gitInFixture(['init', '-q']);
  gitInFixture(['add', '-A']);
  commitFixture('fixture: source, no baseline artifact in HEAD yet');
}

type Ceilings = Record<string, number>;
type PublishedArtifact = {
  ceilings: Ceilings;
  files: Record<string, { prettierClean: boolean }>;
};
type GeneratorRun = { code: number; out: string; artifact: string };

function artifactBytes(): string {
  return existsSync(ARTIFACT) ? readFileSync(ARTIFACT, 'utf8') : NO_ARTIFACT;
}

/** The real generator, as a subprocess, in the fixture and nowhere else. */
function runGenerator(argv: readonly string[] = []): GeneratorRun {
  buildFixture();
  const spawned = spawnSync(process.execPath, [GENERATOR, ...argv], {
    cwd: FIXTURE,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024
  });
  if (spawned.error !== undefined) throw spawned.error;
  // Every diagnostic the generator writes goes to stderr; stdout stays empty.
  return {
    code: spawned.status ?? 1,
    out: `${spawned.stdout ?? ''}${spawned.stderr ?? ''}`,
    artifact: artifactBytes()
  };
}

function writeArtifact(text: string): string {
  buildFixture();
  writeFixtureFile(ARTIFACT_REL, text);
  return text;
}

/**
 * The previous side of every arm in this file, as a git object: the artifact is
 * written AND committed, so "the previous ceilings" is what HEAD says rather than
 * what an edit of the working tree happens to say. The working copy carries the
 * same bytes, which keeps these arms about the comparison; the arms about an
 * edited working copy live in `baseline-monotonicity-head-anchor.test.ts`.
 */
function writePreviousArtifact(ceilings: Ceilings): string {
  buildFixture();
  const text = writeArtifact(`${JSON.stringify({ version: 3, ceilings }, null, 2)}\n`);
  gitInFixture(['add', '-A']);
  commitFixture('fixture: HEAD carries the previous ceilings');
  return text;
}

function parsePublished(text: string): PublishedArtifact {
  return JSON.parse(text) as PublishedArtifact;
}

let probe: GeneratorRun | null = null;

/**
 * Decision-table row 6 at process level, and the probe every other process arm
 * reads its numbers from: a previous artifact that is not JSON at all. Without
 * the opt-in the generator must refuse it; with `--seed` it must write, and what
 * it writes is this fixture's own measurement — which is how the arms below learn
 * what "higher" and "lower" mean without typing a single ceiling.
 */
function seedProbe(): GeneratorRun {
  if (probe === null) {
    writeArtifact('{ this is not JSON, and a ratchet cannot be rebuilt from it\n');
    probe = runGenerator([SEED_FLAG]);
  }
  return probe;
}

let measured: Ceilings | null = null;

function measuredCeilings(): Ceilings {
  if (measured === null) measured = parsePublished(seedProbe().artifact).ceilings;
  return measured;
}

/** The measured vector with keys moved, added or dropped — never a typed copy. */
function ceilingsLike(
  overrides: Record<string, number | undefined>,
  dropped: readonly string[] = []
): Ceilings {
  const merged: Record<string, number | undefined> = { ...measuredCeilings(), ...overrides };
  for (const key of dropped) delete merged[key];
  return Object.fromEntries(
    Object.entries(merged).filter((entry) => entry[1] !== undefined)
  ) as Ceilings;
}

function ceilingOf(ceilings: Ceilings, key: string): number {
  const value = ceilings[key];
  if (typeof value !== 'number') {
    throw new Error(
      `the fixture measured no numeric ceiling at "${key}"; it reported ${JSON.stringify(ceilings)}`
    );
  }
  return value;
}

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// integration — does the real generator refuse before it writes?
// ---------------------------------------------------------------------------

describe('Scenario: integration — the generator process against the isolated fixture', () => {
  it(
    'A4 — when the fixture measures a raise over the previous artifact, should exit 1 and leave the artifact bytes untouched',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const raised = ceilingOf(measuredCeilings(), RAISED_KEY);
      expect(raised, 'the fixture must really measure a dirty file').toBeGreaterThan(0);
      // A real prettier, a real verdict: the raise is not a stub's invention.
      const flags = parsePublished(seedProbe().artifact).files;
      expect(flags['src/lumpy.ts']?.prettierClean, 'lumpy.ts must be dirty').toBe(false);
      expect(flags['src/tidy.ts']?.prettierClean, 'tidy.ts must be clean').toBe(true);

      const previous = writePreviousArtifact(ceilingsLike({ [RAISED_KEY]: raised - 1 }));
      const run = runGenerator();
      expect(run.code, run.out).toBe(1);
      expect(run.out, run.out).toContain('REFUSING to write');
      expect(run.artifact, 'the refusal must happen before the write').toBe(previous);
    }
  );

  it(
    'A4 control — the same fixture with a previous artifact one higher should write, and what it writes is this run’s measurement',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const raised = ceilingOf(measuredCeilings(), RAISED_KEY);
      const previous = writePreviousArtifact(ceilingsLike({ [RAISED_KEY]: raised + 1 }));
      const run = runGenerator();
      expect(run.code, run.out).toBe(0);
      expect(run.out, run.out).not.toContain('REFUSING');
      expect(run.artifact, 'the permitted write must land').not.toBe(previous);
      expect(ceilingOf(parsePublished(run.artifact).ceilings, RAISED_KEY)).toBe(raised);
    }
  );

  it(
    'row 6 at process level — an unparseable previous artifact should refuse until the caller opts into seeding',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const corrupt = writeArtifact('{ not JSON, and a ratchet cannot be rebuilt from it\n');
      const refused = runGenerator();
      expect(refused.code, refused.out).toBe(1);
      expect(refused.out, refused.out).toContain('REFUSING to write');
      expect(refused.out).toContain(SEED_FLAG);
      expect(refused.artifact, 'a corrupt artifact stays until a human seeds').toBe(corrupt);

      const seeded = seedProbe();
      expect(seeded.code, seeded.out).toBe(0);
      expect(seeded.out).toContain('SEED');
      expect(seeded.artifact).not.toBe(corrupt);
      expect(Object.keys(parsePublished(seeded.artifact).ceilings).length).toBeGreaterThan(0);
    }
  );
});

// ---------------------------------------------------------------------------
// render — what a permitted write says about the rows it moved
// ---------------------------------------------------------------------------

describe('Scenario: render — the lines a permitted write prints', () => {
  it(
    'when debt was cleared and a row is new, should name both instead of writing quietly',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const cleared = ceilingOf(measuredCeilings(), 'fileSizeExcessLines') + 40;
      writePreviousArtifact(
        ceilingsLike({ fileSizeExcessLines: cleared, eslintPhantomFindings: 3 }, ['tscErrors'])
      );
      const run = runGenerator();
      expect(run.code, run.out).toBe(0);
      expect(run.out, run.out).not.toContain('REFUSING');
      expect(run.out).toContain('CLEARED');
      expect(run.out).toContain(`fileSizeExcessLines: ${cleared} → `);
      // A descent to zero is still a descent: this row is measured at 0 here and
      // the previous artifact carried it at 3.
      expect(run.out).toContain('eslintPhantomFindings: 3 → 0');
      // A row the previous artifact did not carry at all must be called NEW, and
      // never printed as though it had been measured against something.
      expect(run.out).toContain('NEWLY SEEDED');
      expect(run.out).toContain('tscErrors');
    }
  );

  it(
    'when nothing moved, should write without inventing a cleared or a new row',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      writePreviousArtifact(ceilingsLike({}));
      const run = runGenerator();
      expect(run.code, run.out).toBe(0);
      expect(run.out, run.out).not.toContain('REFUSING');
      expect(run.out).not.toContain('CLEARED');
      expect(run.out).not.toContain('NEWLY SEEDED');
      expect(run.out).toContain('wrote');
    }
  );
});

// ---------------------------------------------------------------------------
// a11y — the sentence an operator reads when the ratchet tries to move up
// ---------------------------------------------------------------------------

describe('Scenario: a11y — what a raise says to the human who hit it', () => {
  it(
    'when a ceiling rose, should name the key, its old and new numbers, and say nothing was written',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const raised = ceilingOf(measuredCeilings(), RAISED_KEY);
      writePreviousArtifact(ceilingsLike({ [RAISED_KEY]: raised - 1 }));
      const run = runGenerator();
      expect(run.code, run.out).toBe(1);
      expect(run.out).toContain(`${RAISED_KEY}: ${raised - 1} → ${raised}`);
      expect(run.out).toContain('Nothing has been written; the existing ceilings are untouched.');
      // The advice is the artifact's own sentence, kept: a raise is a regression
      // to fix, not a number to commit, and the way down is the measurement.
      expect(run.out).toMatch(/DOWN|may only go down/);
      expect(run.out).toContain('Fix the regression');
    }
  );

  it(
    'when a ceiling row vanished from the measurement, should refuse and name the key that disappeared',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // The previous artifact carries a row this run does not measure — the shape
      // a rename or a deleted generator line leaves behind. It cannot be produced
      // by editing the fixture, because the fixture measures what it measures, so
      // it is added to the previous side, which is exactly where such a row lives.
      const dropped = writePreviousArtifact(
        ceilingsLike({ legacyCeilingRowFromThePreviousGeneration: 5 })
      );
      const run = runGenerator();
      expect(run.code, run.out).toBe(1);
      expect(run.out).toContain('REFUSING to write');
      expect(run.out).toContain('legacyCeilingRowFromThePreviousGeneration');
      expect(run.out).toContain('REMOVED');
      expect(run.out).toContain('Nothing has been written; the existing ceilings are untouched.');
      expect(run.artifact, 'the weakening must not be written either').toBe(dropped);
    }
  );
});
