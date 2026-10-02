// tests/unit/lint/baseline-monotonicity-head-anchor.test.ts
//
// Rid 2026-10-02-monotonicity-head-anchor — repair cycle 1 of §2.27 (backlog §2.33).
// C wave 8 shipped the monotonicity rule; THIS file is the out-of-band review of
// WHERE that rule read its "previous" number from.
//
// THE HOLE, AS MEASURED. `.husky/peaks-gate-baseline.mjs` compared the fresh measurement
// against `readFileSync(OUT_PATH)` — the working-tree artifact: the file the run is about
// to overwrite, and the file a weakening edits. An out-of-band reviewer ran four fixtures
// that really measured `prettierUnformatted: 2`; the shipped verdicts were:
//
//   | previous artifact      | what shipped did                          |
//   |------------------------|-------------------------------------------|
//   | row present at `1`     | exit 1 REFUSING, bytes untouched (works)   |
//   | row **deleted**        | exit 0, `NEWLY SEEDED`, wrote ceiling 2     |
//   | row inflated to `999`  | exit 0, `CLEARED — 1 ceiling(s) went DOWN`  |
//   | `"ceilings": {}`       | exit 0, all 13 rows re-seeded              |
//
// Those four are `H1`, `H2`, `H3` and the control `H0` below. The fix anchors the
// previous side in `git show HEAD:.peaks/lint/gate-baseline.json` and keeps the working
// copy as a SECOND, INDEPENDENT trip — so `H2` is refused by the trip even though
// HEAD-vs-measurement is clean, and `H1`/`H3` are refused because dropping a row from the
// file the gate reads is exactly the edit the trip names.
//
// WHY THE FIXTURE COMMITS: the anchor is a git object, so `buildFixture()` makes one
// commit with NO artifact in it (`H5a`'s state) and every other arm writes the artifact
// and commits it — that is what makes "HEAD says X, working copy says Y" reachable.
// Nothing is written into this repository: the fixture lives under
// `mkdtempSync(join(tmpdir(), …))` and is deleted in `afterAll` (§2.31). No ceiling is
// typed either — `measuredCeilings()` learns the fixture's own measurement from a
// `--seed` run into an empty HEAD.
//
// Dimensions:
//   - integration: the real generator as a subprocess in a real git fixture, with the
//                  artifact bytes asserted before and after every refused run
//   - a11y:        the exit code plus the sentence the operator reads: the key, both
//                  sides' numbers, and how to restore the artifact from HEAD
//   - behavior:    omitted — the decision table and the canonical key audit are
//                  asserted on the pure comparison in baseline-monotonicity.test.ts
//   - render:      omitted — what a PERMITTED write prints is asserted in
//                  baseline-monotonicity-generator.test.ts

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
  'tests/unit/lint/baseline-monotonicity-head-anchor.test.ts',
  ['integration', 'a11y'],
  [
    {
      dim: 'behavior',
      reason: 'the decision table and the canonical key audit are the pure file’s subject'
    },
    {
      dim: 'render',
      reason: 'the notes a permitted write prints are asserted in the generator sibling'
    }
  ]
);

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const GENERATOR = join('.husky', 'peaks-gate-baseline.mjs');
// Staged by WALK so the copied set follows the tree when an entry gains siblings
// (`.husky/monotonic/*.mjs`, rid 2026-10-02-wave9-monotonic-split; same rule as
// `baseline-monotonicity-generator.test.ts` — `hooksScopeFilesUnder` is the census's).
const GENERATOR_FILES = hooksScopeFilesUnder(REPO_ROOT);
const MONOTONIC_MODULE = join(REPO_ROOT, '.husky', 'peaks-gate-baseline-monotonic.mjs');
const ARTIFACT_REL = join('.peaks', 'lint', 'gate-baseline.json');
/** The same path the way git spells it: slash-separated, relative to the repo root. */
const ARTIFACT_GIT_PATH = '.peaks/lint/gate-baseline.json';
const SEED_FLAG = '--seed';
const RAISED_KEY = 'prettierUnformatted';
const DROPPED_KEY = 'silentWarningEmptyCatch';
const SEEDED_KEY = 'fileSizeExcessLines';
const NO_ARTIFACT = '<no artifact on disk>';

const SCRATCH = mkdtempSync(join(tmpdir(), 'peaks-baseline-head-anchor-'));
const FIXTURE = join(SCRATCH, 'repo');
const ARTIFACT = join(FIXTURE, ARTIFACT_REL);

const ESLINT_STUB = "process.stdout.write('[]\\n');\n";
const TSC_STUB = "process.stdout.write('');\n";
const DETECTOR_STUB =
  "console.log(JSON.stringify({ scannedFiles: 3, byRule: { 'catch-return-null': 1, 'empty-catch': 2 } }));\n";
const CENSUS_STUB =
  'process.stdout.write(JSON.stringify({ overCap: 1, excessLines: 9, ' +
  "convention: 'split(String.fromCharCode(10)).length', caps: { defaultCap: 300, testsCap: 500 }, " +
  "scope: { countedFiles: 3, source: 'git ls-files <policy dirs>', dirs: ['src'], " +
  "extensions: ['ts'] }, byDir: { src: { files: 3 } }, " +
  // The `.husky/` block the two hooks rows read (§2.32); refused if absent.
  "hooks: { overCap: 1, excessLines: 4, caps: { hooksCap: 300 }, convention: 'split(String.fromCharCode(10)).length', scope: { countedFiles: 2, source: 'git ls-files <hooks dirs>', dirs: ['.husky'], extensions: ['mjs'] }, files: [] } }) + '\\n');\n";
const PRETTIER_PACKAGE =
  '{"name":"prettier","version":"0.0.0-fixture","type":"module","exports":{".":"./index.mjs"}}\n';

/** A git identity and a hooks path of the fixture’s own, so no host config leaks in. */
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
type CanonicalModule = { CEILING_KEYS?: readonly string[] };

function writeFixtureFile(relative: string, text: string): string {
  const abs = join(FIXTURE, relative);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text, 'utf8');
  return abs;
}

function gitInFixture(args: readonly string[]): string {
  return execFileSync('git', args, {
    cwd: FIXTURE,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function commitFixture(message: string): void {
  gitInFixture([...GIT_NEUTRAL, 'commit', '-q', '--allow-empty', '-m', message]);
}

function prettierShim(): string {
  const real = pathToFileURL(join(REPO_ROOT, 'node_modules', 'prettier', 'index.mjs')).href;
  return `export { default } from '${real}';\nexport * from '${real}';\n`;
}

let fixtureBuilt = false;

/**
 * A two-file repository whose HEAD commit carries NO baseline artifact: the honest
 * starting point of a ratchet, and the state `H5a` measures.
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
      { name: 'peaks-head-anchor-fixture', version: '0.0.0', prettier: declaredPrettier },
      null,
      2
    )}\n`
  );
  writeFixtureFile('src/lumpy.ts', 'export const   unformatted=1;\n');
  writeFixtureFile('src/tidy.ts', 'export const tidy = 1;\n');
  writeFixtureFile('scripts/lint/silent-warning-detector.mjs', DETECTOR_STUB);
  writeFixtureFile('node_modules/eslint/bin/eslint.js', ESLINT_STUB);
  writeFixtureFile('node_modules/typescript/bin/tsc', TSC_STUB);
  writeFixtureFile('node_modules/tsx/dist/cli.mjs', CENSUS_STUB);
  writeFixtureFile('node_modules/prettier/package.json', PRETTIER_PACKAGE);
  writeFixtureFile('node_modules/prettier/index.mjs', prettierShim());
  for (const relative of GENERATOR_FILES) {
    if (existsSync(join(REPO_ROOT, relative))) {
      copyFileSync(join(REPO_ROOT, relative), writeFixtureFile(relative, ''));
    }
  }
  gitInFixture(['init', '-q']);
  gitInFixture(['add', '-A']);
  commitFixture('fixture: source, no baseline artifact in HEAD');
}

function runGenerator(argv: readonly string[] = [], env?: NodeJS.ProcessEnv): GeneratorRun {
  buildFixture();
  const spawned = spawnSync(process.execPath, [GENERATOR, ...argv], {
    cwd: FIXTURE,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    env
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

/** Move HEAD's anchor: write the artifact AND commit it, so HEAD is what says X. */
function anchorHeadAt(ceilings: Ceilings): string {
  buildFixture();
  const text = artifactText(ceilings);
  writeFixtureFile(ARTIFACT_REL, text);
  gitInFixture(['add', '-A', ARTIFACT_GIT_PATH]);
  commitFixture('fixture: HEAD carries the anchor');
  return text;
}

/** Edit only the working copy — the move every one of the reviewer's attacks made. */
function editWorkingCopy(ceilings: Ceilings): string {
  buildFixture();
  const text = artifactText(ceilings);
  writeFixtureFile(ARTIFACT_REL, text);
  return text;
}

function removeAnchorFromHead(): void {
  buildFixture();
  const tracked = spawnSync('git', ['ls-files', '--error-unmatch', ARTIFACT_GIT_PATH], {
    cwd: FIXTURE,
    encoding: 'utf8',
    windowsHide: true
  });
  if (tracked.status === 0) gitInFixture(['rm', '--cached', '--quiet', ARTIFACT_GIT_PATH]);
  rmSync(ARTIFACT, { force: true });
  commitFixture('fixture: HEAD has no baseline artifact at all');
}

let measured: Ceilings | null = null;

/** The fixture's own measurement, learned from a seed run into an empty HEAD. */
function measuredCeilings(): Ceilings {
  if (measured === null) {
    removeAnchorFromHead();
    const seeded = runGenerator([SEED_FLAG]);
    if (seeded.code !== 0 || seeded.artifact === NO_ARTIFACT) {
      throw new Error(`the fixture seed run must write: exit ${seeded.code}\n${seeded.out}`);
    }
    measured = (JSON.parse(seeded.artifact) as ArtifactShape).ceilings;
    rmSync(ARTIFACT, { force: true });
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
  if (typeof value !== 'number') {
    throw new Error(`the fixture measured no numeric ceiling at "${key}"`);
  }
  return value;
}

function writtenCeilings(text: string): Ceilings {
  return (JSON.parse(text) as ArtifactShape).ceilings;
}

async function canonicalKeys(): Promise<string[]> {
  const module = (await import(pathToFileURL(MONOTONIC_MODULE).href)) as CanonicalModule;
  expect(
    Array.isArray(module.CEILING_KEYS),
    '.husky/peaks-gate-baseline-monotonic.mjs must export the canonical ceiling key list'
  ).toBe(true);
  return [...(module.CEILING_KEYS ?? [])];
}

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

/** RA2's three things for EVERY refusal arm, in one place so no arm forgets the third:
 * exit 1, no bytes moved — the sentence the operator needs is asserted per arm. */
function expectRefusal(run: GeneratorRun, bytes: string): void {
  expect(run.code, run.out).toBe(1);
  expect(run.out, run.out).toContain('REFUSING to write');
  expect(run.artifact, 'a refused run must not move the artifact bytes').toBe(bytes);
}

describe('Scenario: integration — an edit of the working-tree artifact cannot move the anchor', () => {
  it(
    'H0 control — when HEAD and the working copy agree one below the measurement, should exit 1 on RAISED and leave the bytes untouched',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const raised = ceilingOf(measuredCeilings(), RAISED_KEY);
      expect(raised, 'the fixture must really measure a dirty file').toBeGreaterThan(0);
      const previous = anchorHeadAt(ceilingsLike({ [RAISED_KEY]: raised - 1 }));
      const run = runGenerator();
      expectRefusal(run, previous);
      expect(run.out).toContain(`${RAISED_KEY}: ${raised - 1} → ${raised}`);
    }
  );

  it(
    'H1 attack — when the working copy deletes one row HEAD carries, should exit 1 naming the key and HEAD’s number, not re-seed it',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // The shipped guard read the working copy as "previous", so a deleted row
      // looked brand-new and the run wrote it: `NEWLY SEEDED`, exit 0.
      const held = ceilingOf(measuredCeilings(), DROPPED_KEY);
      anchorHeadAt(ceilingsLike({ [DROPPED_KEY]: held }));
      const attacked = editWorkingCopy(ceilingsLike({}, [DROPPED_KEY]));
      const run = runGenerator();
      expectRefusal(run, attacked);
      expect(run.out).toContain(DROPPED_KEY);
      expect(run.out, 'the operator needs both sides').toMatch(
        new RegExp(`${DROPPED_KEY}[^\\n]*${held}`)
      );
      expect(run.out).toMatch(/working copy|no such row|deleted/i);
      expect(run.out).toMatch(/git checkout HEAD/);
      expect(run.out).not.toContain('NEWLY SEEDED');
    }
  );

  it(
    'H2 attack — when the working copy inflates one row above HEAD, should exit 1 even though HEAD vs the measurement is clean',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // HEAD carries the measurement itself, so only the working-copy trip sees this edit.
      const held = ceilingOf(measuredCeilings(), RAISED_KEY);
      anchorHeadAt(ceilingsLike({ [RAISED_KEY]: held }));
      const attacked = editWorkingCopy(ceilingsLike({ [RAISED_KEY]: 999 }));
      const run = runGenerator();
      expectRefusal(run, attacked);
      expect(run.out).toContain(RAISED_KEY);
      expect(run.out, 'both sides, or the operator cannot tell what changed').toMatch(
        new RegExp(`${RAISED_KEY}[^\\n]*${held}[^\\n]*999`)
      );
      expect(run.out).not.toContain('CLEARED');
    }
  );

  it(
    'H3 attack — when the working copy is emptied of ceilings, should exit 1 naming every dropped canonical row instead of re-seeding all thirteen',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      anchorHeadAt(ceilingsLike({}));
      const attacked = editWorkingCopy({});
      const run = runGenerator();
      expectRefusal(run, attacked);
      expect(run.out).not.toContain('NEWLY SEEDED');
      const keys = await canonicalKeys();
      for (const key of keys) {
        expect(run.out, `the refusal must name ${key}`).toContain(key);
      }
    }
  );

  it(
    'H4 — when the working copy only LOWERS a row, should treat it as a stricter request and reach the normal path',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const held = ceilingOf(measuredCeilings(), SEEDED_KEY);
      anchorHeadAt(ceilingsLike({ [SEEDED_KEY]: held }));
      editWorkingCopy(ceilingsLike({ [SEEDED_KEY]: 0 }));
      const run = runGenerator();
      expect(run.code, run.out).toBe(0);
      expect(run.out, run.out).not.toContain('REFUSING');
      expect(run.out, 'the replaced hand edit is named').toMatch(/working copy|disk/i);
      expect(ceilingOf(writtenCeilings(run.artifact), SEEDED_KEY)).toBe(held);
    }
  );

  it(
    'H4b — when HEAD genuinely does not carry a canonical row and nothing else does either, should still seed it',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // How `fileSizeExcessLines` was seeded on 2026-10-01, and that door stays open.
      anchorHeadAt(ceilingsLike({}, [SEEDED_KEY]));
      const run = runGenerator();
      expect(run.code, run.out).toBe(0);
      expect(run.out, run.out).not.toContain('REFUSING');
      expect(run.out).toContain('NEWLY SEEDED');
      expect(run.out).toContain(SEEDED_KEY);
      expect(ceilingOf(writtenCeilings(run.artifact), SEEDED_KEY)).toBe(
        ceilingOf(measuredCeilings(), SEEDED_KEY)
      );
    }
  );
});

describe('Scenario: integration — a guard that reddens its own happy path is a broken instrument', () => {
  it(
    'H-RA3 — when the generator runs twice against an unchanged HEAD, the second run should exit 0 with byte-identical ceilings',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      anchorHeadAt(ceilingsLike({}));
      const first = runGenerator();
      expect(first.code, first.out).toBe(0);
      expect(first.out, first.out).not.toContain('REFUSING');
      const second = runGenerator();
      expect(second.code, second.out).toBe(0);
      expect(second.out, second.out).not.toContain('REFUSING');
      expect(JSON.stringify(writtenCeilings(second.artifact))).toBe(
        JSON.stringify(writtenCeilings(first.artifact))
      );
      expect(JSON.stringify(writtenCeilings(second.artifact))).toBe(
        JSON.stringify(measuredCeilings())
      );
    }
  );

  it(
    'H-RA4 — a permitted write should carry exactly the canonical ceiling keys, no more and no fewer',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const keys = await canonicalKeys();
      anchorHeadAt(ceilingsLike({}));
      const run = runGenerator();
      expect(run.code, run.out).toBe(0);
      expect(Object.keys(writtenCeilings(run.artifact)).sort()).toEqual([...keys].sort());
      expect(new Set(keys).size).toBe(keys.length);
    }
  );

  it(
    'H-anchor-extra-row — when HEAD’s artifact carries a row that is not canonical, should exit 1 and name it',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const anchored = anchorHeadAt({ ...measuredCeilings(), legacyRowNobodySanctioned: 5 });
      const run = runGenerator();
      expectRefusal(run, anchored);
      expect(run.out).toContain('legacyRowNobodySanctioned');
      expect(run.out).toMatch(/canonical/i);
    }
  );
});

describe('Scenario: a11y — no HEAD artifact and no git must land on the seed path, not on a stack trace', () => {
  it(
    'H5a — when HEAD has no such path, should refuse naming --seed whether or not the working copy does, then write all thirteen rows when it is passed',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      measuredCeilings();
      for (const carryWorkingCopy of [false, true]) {
        removeAnchorFromHead();
        const carried = carryWorkingCopy ? editWorkingCopy(ceilingsLike({})) : NO_ARTIFACT;
        const refused = runGenerator();
        expect(refused.code, refused.out).toBe(1);
        expect(refused.out, refused.out).toContain('REFUSING to write');
        expect(refused.out).toContain(SEED_FLAG);
        expect(refused.out).toMatch(/HEAD/);
        expect(refused.artifact, 'a refusal must not write over what it refused').toBe(carried);
      }
      // The second state above is the one C wave 8 accepted: a working copy that
      // looks exactly like a baseline, and no anchor to say otherwise.
      const keys = await canonicalKeys();
      const seeded = runGenerator([SEED_FLAG]);
      expect(seeded.code, seeded.out).toBe(0);
      expect(seeded.out).toContain('SEED');
      expect(Object.keys(writtenCeilings(seeded.artifact)).sort()).toEqual([...keys].sort());
    }
  );

  it(
    'H5b — when git cannot be run at all, should refuse with the reason instead of crashing, and stay clean under --seed too',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // A PATH with nothing on it: `git show` cannot resolve, and neither can the
      // scope's `git ls-files`, so this measures the whole no-git surface.
      const emptyBin = join(SCRATCH, 'empty-bin');
      mkdirSync(emptyBin, { recursive: true });
      const noGit: NodeJS.ProcessEnv = { ...process.env, PATH: emptyBin };
      const anchored = anchorHeadAt(ceilingsLike({}));

      for (const argv of [[], [SEED_FLAG]]) {
        const run = runGenerator(argv, noGit);
        expect(run.code, run.out).toBe(1);
        expect(run.out, run.out).toContain('REFUSING to write');
        expect(run.out, 'a refusal, not a stack trace').not.toContain('node:internal');
        expect(run.out).toMatch(/git/);
        expect(run.artifact, 'a refusal must not touch the bytes it refused about').toBe(anchored);
      }
    }
  );
});
