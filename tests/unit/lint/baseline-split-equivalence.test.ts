// tests/unit/lint/baseline-split-equivalence.test.ts
//
// Rid `2026-10-02-wave9-generator-split`, repair cycle 2. The generator entry's header
// claims the split of `.husky/peaks-gate-baseline.mjs` was "proven behaviourally in a
// fixture repo against `git show HEAD:.husky/peaks-gate-baseline.mjs`". THIS file is that
// proof. Cycle 1 anchored the reference on `HEAD` — true only while the slice was
// UNCOMMITTED. The commit that landed it (`c6de09a6`) moved `HEAD` to the SPLIT file, whose
// `./baseline/` imports the head fixture deliberately does not stage, so every arm died on
// `Cannot find module …/head/.husky/baseline/anchor.mjs`. A test that points at "the current
// tip" validates itself the day it is written and self-destructs the day it is committed. So
// the reference is pinned to `77b711ff` (`c6de09a6`'s parent), the 799-line monolith the
// split was cut from; the "pinned anchor" scenario below re-checks that pinning from both
// ends and fails naming what moved rather than eleven traces.
//
// HOW. Two throwaway repositories with identical inputs: `head/` runs the generator as the
// pinned `77b711ff` carries it, staged out of git, with the dependency closure that BOTH
// sides read from the working tree (`peaks-gate-file-size.mjs`, `-baseline-monotonic.mjs`,
// `.husky/monotonic/*`); `split/` runs the working-tree entry plus `.husky/baseline/*`. The
// closure is shared, so the ONLY difference between the programs is the split itself. Each
// state is applied to BOTH before either runs. The four states the claim
// difference between the processes is the program under test. The four states the claim
// names — the seed path and the three §2.33 attacks (delete a row, lift a row, empty
// `ceilings`) — are compared on exit code, artifact BYTES modulo `generatedAt`, stdout and
// stderr. stderr is a leg because the refusal wording lives there, and wording is what a
// refactor reflows while every "it still refuses" check stays green. Two programs that
// both crash on load agree on every leg, so each arm also states the reference side's
// verdict, and the three MUTATION CONTROL arms break ONE leg of the split copy (a dropped
// refusal, a reflowed diagnostic, one word of the note) and show it red.
//
// eslint, tsc, the detector and the census are stubbed (both sides get the same bytes, or
// the comparison measures the stubs); prettier is NOT. Fixtures are `mkdtempSync` under
// the OS temp dir, removed in `afterAll` (§2.31); each run's cwd is its own fixture, which
// is where the generator's ROOT resolves, so nothing here touches this repository.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import { GENERATOR_DIR_REL, REPO_ROOT } from '../standards/_file-size-cap-scan.js';
import { projectArtifact, projectStderr } from './_rescope-projection.js';
import { hooksScopeFilesUnder } from './_file-size-hooks-fixture.js';

declareDimensions(
  'tests/unit/lint/baseline-split-equivalence.test.ts',
  ['integration', 'behavior', 'render', 'a11y'],
  []
);

const GENERATOR_REL = '.husky/peaks-gate-baseline.mjs';
const SPAWN_TARGET = join('.husky', 'peaks-gate-baseline.mjs');
const ARTIFACT_REL = join('.peaks', 'lint', 'gate-baseline.json');
const ARTIFACT_GIT_PATH = '.peaks/lint/gate-baseline.json';
const SEED_FLAG = '--seed';
const RAISED_KEY = 'prettierUnformatted';
const DROPPED_KEY = 'silentWarningEmptyCatch';
const NO_ARTIFACT = '<no artifact on disk>';
/** The one field the bytes leg is allowed to ignore. */
const GENERATED_AT = /"generatedAt": "[^"]*"/;
const SCRATCH = mkdtempSync(join(tmpdir(), 'peaks-gen-equivalence-'));

// Both fixtures get THESE bytes, so a difference between the runs cannot be a difference
// between the stubs.
const ESLINT_STUB = "process.stdout.write('[]\\n');\n";
const TSC_STUB = "process.stdout.write('');\n";
const DETECTOR_STUB =
  "console.log(JSON.stringify({ scannedFiles: 3, byRule: { 'catch-return-null': 1, 'empty-catch': 2 } }));\n";
const CENSUS_STUB =
  'process.stdout.write(JSON.stringify({ overCap: 1, excessLines: 9, ' +
  "convention: 'split(String.fromCharCode(10)).length', caps: { defaultCap: 300, testsCap: 500 }, " +
  "scope: { countedFiles: 3, source: 'git ls-files <policy dirs>', dirs: ['src'], " +
  "extensions: ['ts'] }, files: [{ file: 'src/big.ts', lines: 309, cap: 300, excess: 9 }], byDir: { src: { files: 3 } }, " +
  "hooks: { overCap: 1, excessLines: 4, caps: { hooksCap: 300 }, convention: 'split(String.fromCharCode(10)).length', scope: { countedFiles: 2, source: 'git ls-files <hooks dirs>', dirs: ['.husky'], extensions: ['mjs'] }, files: [] } }) + '\\n');\n";
const PRETTIER_PACKAGE =
  '{"name":"prettier","version":"0.0.0-fixture","type":"module","exports":{".":"./index.mjs"}}\n';
const GIT_NEUTRAL =
  '-c user.name=peaks-fixture -c user.email=peaks-fixture@invalid.invalid -c commit.gpgsign=false -c core.hooksPath=.git/hooks -c core.autocrlf=false'.split(
    ' '
  );

type Side = 'head' | 'split';
const SIDES: readonly Side[] = ['head', 'split'];
type Ceilings = Record<string, number>;
type ArtifactShape = { ceilings: Ceilings };
type Run = { code: number; stdout: string; stderr: string; artifact: string };
type Pair = { head: Run; split: Run };
type Diff = { code: boolean; stdout: boolean; stderr: boolean; artifact: boolean };
type ScenarioKey = 'seed' | 'dropRow' | 'liftRow' | 'emptyCeilings' | 'write';

const rootOf = (side: Side): string => join(SCRATCH, side);
const artifactPath = (root: string): string => join(root, ARTIFACT_REL);
const artifactOf = (root: string): string =>
  existsSync(artifactPath(root)) ? readFileSync(artifactPath(root), 'utf8') : NO_ARTIFACT;

function writeIn(root: string, rel: string, text: string): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text, 'utf8');
}
const artifactText = (ceilings: Ceilings): string =>
  `${JSON.stringify({ version: 3, ceilings }, null, 2)}\n`;
function gitIn(root: string, args: readonly string[]): void {
  execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
}

/** Not a stub: the fixture's prettier re-exports the repository's installed copy. */
function prettierShim(): string {
  const real = pathToFileURL(join(REPO_ROOT, 'node_modules', 'prettier', 'index.mjs')).href;
  return `export { default } from '${real}';\nexport * from '${real}';\n`;
}
/**
 * The pre-split commit the reference side is pinned to. `c6de09a6` IS the split, so its
 * parent is the last commit whose `peaks-gate-baseline.mjs` is still the 799-line monolith
 * the split was cut from. `HEAD` cannot be the anchor: landing the split is exactly what
 * moves `HEAD` off the monolith, which is the self-destructing-anchor defect cycle 1 had.
 */
const PRE_SPLIT_ANCHOR_SHA = '77b711ff';
/** `git show <ref>:` on the generator entry — the reference comes from git, not the tree. */
function gitShowGenerator(ref: string): string {
  return execFileSync('git', ['show', `${ref}:${GENERATOR_REL}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true
  });
}
/** The pinned monolithic generator, read out of git once and memoised. */
let anchorEntry: string | null = null;
function anchorGeneratorText(): string {
  if (anchorEntry === null) anchorEntry = gitShowGenerator(PRE_SPLIT_ANCHOR_SHA);
  return anchorEntry;
}
/**
 * The `.husky` set each side stages — by WALK (`hooksScopeFilesUnder`, the census's own
 * rule), the mechanism slices 1 and 2 built for exactly this hazard. The HEAD side is that
 * walk minus `.husky/baseline/`, the directory this split created.
 */
function filesFor(side: Side): string[] {
  const walk = hooksScopeFilesUnder(REPO_ROOT);
  return side === 'split' ? walk : walk.filter((rel) => !rel.startsWith(GENERATOR_DIR_REL));
}

const built = new Set<Side>();
function build(side: Side): void {
  if (built.has(side)) return;
  built.add(side);
  const root = rootOf(side);
  const declaredPrettier = (
    JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      prettier: Record<string, unknown>;
    }
  ).prettier;
  const pkg = { name: 'peaks-gen-equiv-fixture', version: '0.0.0', prettier: declaredPrettier };
  writeIn(root, 'package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  // Dirty on purpose: the fixture must really measure a `prettierUnformatted` raise.
  writeIn(root, 'src/lumpy.ts', 'export const   unformatted=1;\n');
  writeIn(root, 'src/tidy.ts', 'export const tidy = 1;\n');
  writeIn(root, 'node_modules/eslint/bin/eslint.js', ESLINT_STUB);
  writeIn(root, 'node_modules/typescript/bin/tsc', TSC_STUB);
  writeIn(root, 'node_modules/tsx/dist/cli.mjs', CENSUS_STUB);
  writeIn(root, 'node_modules/prettier/package.json', PRETTIER_PACKAGE);
  writeIn(root, 'node_modules/prettier/index.mjs', prettierShim());
  for (const rel of filesFor(side)) {
    const text =
      side === 'head' && rel === GENERATOR_REL
        ? anchorGeneratorText()
        : readFileSync(join(REPO_ROOT, rel), 'utf8');
    writeIn(root, rel, text);
  }
  gitIn(root, ['init', '-q']);
  gitIn(root, ['add', '-A']);
  gitIn(root, [...GIT_NEUTRAL, 'commit', '-q', '--allow-empty', '-m', 'fixture: no anchor yet']);
  // THE DETECTOR STUB IS WRITTEN AFTER THE COMMIT, SO IT IS UNTRACKED (rid
  // `2026-10-03-w10-rescope-a`): `git ls-files` is the population, and a tracked
  // file under `scripts/` sits in the old universe but outside the new enforced
  // lint scope — the divergence the rescope introduces ON PURPOSE. Untracked, the
  // fixture's universe and its gated set are the same two `src/` files for BOTH
  // programs, and the ceilings agree unprojected.
  writeIn(root, 'scripts/lint/silent-warning-detector.mjs', DETECTOR_STUB);
}

function runGenerator(side: Side, argv: readonly string[]): Run {
  const root = rootOf(side);
  const spawned = spawnSync(process.execPath, [SPAWN_TARGET, ...argv], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024
  });
  if (spawned.error !== undefined) throw spawned.error;
  return {
    code: spawned.status ?? 1,
    stdout: spawned.stdout ?? '',
    stderr: spawned.stderr ?? '',
    artifact: artifactOf(root)
  };
}
const redact = (text: string): string => text.replace(GENERATED_AT, '"generatedAt": "<dt>"');
// The rescope projection (rationale in `_rescope-projection.ts`): three declared
// surfaces normalised away; every other byte and line still compared strictly.
function differs(a: Run, b: Run): Diff {
  return {
    code: a.code !== b.code,
    stdout: a.stdout !== b.stdout,
    stderr: projectStderr(a.stderr) !== projectStderr(b.stderr),
    artifact: projectArtifact(redact(a.artifact)) !== projectArtifact(redact(b.artifact))
  };
}
const summary = (side: string, run: Run): string =>
  `--- ${side}: exit ${run.code} --- stdout: ${run.stdout} stderr: ${run.stderr} artifact: ${redact(
    run.artifact
  )}`;
const pairSummary = (pair: Pair): string =>
  summary('HEAD', pair.head) + summary('split', pair.split);
const NO_DIFF: Diff = { code: false, stdout: false, stderr: false, artifact: false };
/** What each scenario leaves on the fixtures' working copies, from the same numbers. */
const ROWS: Record<ScenarioKey, (m: Ceilings) => Ceilings | null> = {
  seed: () => null,
  dropRow: (m) => Object.fromEntries(Object.entries(m).filter(([name]) => name !== DROPPED_KEY)),
  liftRow: (m) => ({ ...m, [RAISED_KEY]: 999 }),
  emptyCeilings: () => ({}),
  // The legitimate run §2.35 demands: HEAD and the disk both carry the measurement.
  write: (m) => m
};
/** Only the seed path opts in; the three attacks are plain runs that must refuse. */
const argv = (key: ScenarioKey): readonly string[] => (key === 'seed' ? [SEED_FLAG] : []);

let measured: Ceilings | null = null;

/** Apply one scenario's disk state to one fixture. Idempotent; used by the mutants. */
function applyState(side: Side, key: ScenarioKey): string {
  const root = rootOf(side);
  const rows = ROWS[key](measured ?? {});
  if (rows === null) {
    rmSync(artifactPath(root), { force: true });
    return NO_ARTIFACT;
  }
  writeIn(root, ARTIFACT_REL, artifactText(rows));
  return artifactText(rows);
}

const results = {} as Record<ScenarioKey, Pair>;
let scenariosRun = false;

/**
 * Build both fixtures, learn the fixture's own measurement from a seed run into an empty
 * HEAD, commit that SAME anchor into both HEADs, then run all four states through both
 * programs. Memoised, so the eleven subprocess runs happen once for the whole file.
 */
function scenarios(): { measured: Ceilings; pairs: Record<ScenarioKey, Pair> } {
  if (!scenariosRun) {
    scenariosRun = true;
    build('head');
    build('split');
    for (const key of Object.keys(ROWS) as ScenarioKey[]) {
      for (const side of SIDES) applyState(side, key);
      results[key] = {
        head: runGenerator('head', argv(key)),
        split: runGenerator('split', argv(key))
      };
      if (key !== 'seed') continue;
      if (results.seed.head.code !== 0 || results.seed.head.artifact === NO_ARTIFACT) {
        throw new Error(
          `the HEAD-side seed run must write: exit ${results.seed.head.code}\n${pairSummary(results.seed)}`
        );
      }
      measured = (JSON.parse(results.seed.head.artifact) as ArtifactShape).ceilings;
      // Both HEADs now carry exactly what this fixture measures, which is the anchor
      // every attack below edits in the working copy only.
      const commitAnchor = [...GIT_NEUTRAL, 'commit', '-q', '-m', 'fixture: HEAD is the anchor'];
      for (const side of SIDES) {
        writeIn(rootOf(side), ARTIFACT_REL, artifactText(measured));
        gitIn(rootOf(side), ['add', '-A', ARTIFACT_GIT_PATH]);
        gitIn(rootOf(side), commitAnchor);
      }
    }
  }
  if (measured === null) throw new Error('the seed scenario produced no measurement');
  return { measured, pairs: results };
}

/** Re-apply one scenario and run the split side again — what the mutation arms use. */
const rerunSplit = (key: ScenarioKey): Run => {
  applyState('split', key);
  return runGenerator('split', argv(key));
};
const ceilingOf = (ceilings: Ceilings, key: string): number => {
  const value = ceilings[key];
  if (typeof value !== 'number') throw new Error(`the fixture measured no ceiling at "${key}"`);
  return value;
};

/** A split-copy leg, rewritten in that fixture only, for exactly one run. */
function withBrokenLeg(rel: string, from: string, to: string, run: () => void): void {
  const abs = join(rootOf('split'), rel);
  const pristine = readFileSync(join(REPO_ROOT, rel), 'utf8');
  expect(pristine.split(from).length - 1, `${rel}: "${from}" is one site`).toBe(1);
  try {
    writeFileSync(abs, pristine.replace(from, to), 'utf8');
    run();
  } finally {
    writeFileSync(abs, pristine, 'utf8');
    expect(readFileSync(abs, 'utf8'), 'the mutant must not outlive its arm').toBe(pristine);
  }
}

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

// THE PIN ITSELF IS GUARDED BY THE SIBLING `baseline-split-anchor.test.ts`: cycle 1 anchored
// on `HEAD`, the commit that landed the split invalidated that anchor, and eleven arms died
// on an anonymous module-not-found. `anchorGeneratorText()` above pins the reference to
// `PRE_SPLIT_ANCHOR_SHA`; that sibling fails with a sentence naming what moved if the sha
// ever stops resolving, stops being monolithic, or stops differing from HEAD.

describe('Scenario: integration — HEAD’s generator and the split agree state by state', () => {
  const CASES: ReadonlyArray<[ScenarioKey, string]> = [
    ['seed', 'the seed path (--seed, no anchor in HEAD)'],
    ['dropRow', `§2.33 attack 1 — the working copy deletes ${DROPPED_KEY}`],
    ['liftRow', `§2.33 attack 2 — the working copy lifts ${RAISED_KEY} to 999`],
    ['emptyCeilings', '§2.33 attack 3 — the working copy carries "ceilings": {}'],
    ['write', 'the legitimate second run: disk and HEAD both carry the measurement']
  ];
  for (const [key, label] of CASES) {
    it(
      `${label}: same exit code, same artifact bytes modulo generatedAt, same stdout and stderr`,
      { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
      () => {
        const pair = scenarios().pairs[key];
        expect(differs(pair.head, pair.split), pairSummary(pair)).toEqual(NO_DIFF);
      }
    );
  }
});

describe('Scenario: behavior — the comparison is between two different programs', () => {
  it('the two sides share a closure and stubs byte-for-byte and differ only in the generator', () => {
    const head = filesFor('head');
    const split = filesFor('split');
    expect(head.length, 'the HEAD side stages the closure').toBeGreaterThan(10);
    expect(split.filter((rel) => rel.startsWith(GENERATOR_DIR_REL)).length).toBe(11);
    expect(split.length).toBe(head.length + 11);
    expect(anchorGeneratorText()).not.toBe(readFileSync(join(REPO_ROOT, GENERATOR_REL), 'utf8'));
    expect(head).toContain('.husky/peaks-gate-file-size.mjs');
    expect(head).toContain('.husky/peaks-gate-baseline-monotonic.mjs');
    expect(head.some((rel) => rel.startsWith('.husky/monotonic/'))).toBe(true);
    // Both fixtures receive the SAME working-tree closure bytes for every file except the
    // generator entry (build reads `REPO_ROOT` for all of them), so the only variable in the
    // comparison is the split. We deliberately do NOT require that closure to match the tip:
    // that is the same moving target the anchor commits to a sha, and slice 4's uncommitted
    // file-size split is exactly a case where the tip and the tree legitimately differ. What
    // has to hold is that both programs ran against ONE closure, so every shared file reads
    // byte-for-byte equal straight off the two fixtures.
    for (const rel of head) {
      if (rel === GENERATOR_REL) continue;
      expect(
        readFileSync(join(rootOf('split'), rel)).equals(readFileSync(join(rootOf('head'), rel))),
        rel
      ).toBe(true);
    }
  });

  it(
    'MUTATION CONTROL (a dropped refusal): deleting the working-copy trip reddens the exit-code leg',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const { pairs, measured: m } = scenarios();
      expect(ceilingOf(m, RAISED_KEY), 'the fixture must measure a real raise').toBeGreaterThan(0);
      expect(pairs.liftRow.head.code).toBe(1);
      withBrokenLeg(
        `${GENERATOR_DIR_REL}anchor.mjs`,
        'if (trip.refusal !== null) refuse(trip.refusal);',
        '// the refusal this control deletes',
        () => {
          const mutant = rerunSplit('liftRow');
          const head = pairs.liftRow.head;
          const diff = differs(head, mutant);
          // The trip is what refused; without it the run decides, writes, and exits 0.
          expect(diff.code, pairSummary({ head, split: mutant })).toBe(true);
          expect(diff.artifact, pairSummary({ head, split: mutant })).toBe(true);
          expect(mutant.code, summary('mutant', mutant)).toBe(0);
          expect(mutant.stderr).not.toContain('REFUSING');
        }
      );
    }
  );
});

describe('Scenario: render — the artifact bytes are compared as bytes', () => {
  it(
    'the seed write carries a generatedAt on both sides and it is the only difference redacted',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const pair = scenarios().pairs.seed;
      for (const run of [pair.head, pair.split]) {
        expect(run.artifact, 'the seed path must write').not.toBe(NO_ARTIFACT);
        expect(GENERATED_AT.test(run.artifact), 'the field the leg redacts').toBe(true);
        expect(redact(run.artifact)).not.toBe(run.artifact);
      }
      const rows = (JSON.parse(pair.split.artifact) as ArtifactShape).ceilings;
      expect(Object.keys(rows).length, 'a real ceiling block, not an empty one').toBeGreaterThan(
        10
      );
      expect(projectArtifact(redact(pair.split.artifact))).toBe(
        projectArtifact(redact(pair.head.artifact))
      );
    }
  );

  it(
    'MUTATION CONTROL (reflowed artifact text): one word in the note reddens ONLY the bytes leg',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const { pairs } = scenarios();
      withBrokenLeg(
        `${GENERATOR_DIR_REL}artifact.mjs`,
        'Ratchet baseline for the husky gate.',
        'Ratchet baseline of the husky gate.',
        () => {
          const mutant = rerunSplit('write');
          const head = pairs.write.head;
          const diff = differs(head, mutant);
          expect(head.code, 'the reference side must really be a permitted write').toBe(0);
          expect(diff.artifact, 'the bytes leg must see a byte').toBe(true);
          expect(diff.code, 'the decision did not change').toBe(false);
          expect(diff.stderr, 'no refusal wording changed').toBe(false);
          expect(mutant.stderr, summary('mutant', mutant)).toContain('wrote');
          expect(mutant.artifact).toContain('Ratchet baseline of the husky gate.');
          expect(head.artifact).toContain('Ratchet baseline for the husky gate.');
        }
      );
    }
  );
});

describe('Scenario: a11y — what a refused run says to the human who hit it', () => {
  it(
    'the compared stderr really carries the refusal wording, on both programs',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const { pairs, measured: m } = scenarios();
      const held = ceilingOf(m, DROPPED_KEY);
      const sides: ReadonlyArray<[string, Run]> = [
        ['HEAD', pairs.dropRow.head],
        ['split', pairs.dropRow.split]
      ];
      for (const [side, run] of sides) {
        expect(run.code, `${side} must exit 1`).toBe(1);
        expect(run.stderr, `${side} must refuse`).toContain('REFUSING to write');
        expect(run.stderr, `${side} must name the row`).toContain(DROPPED_KEY);
        expect(run.stderr, `${side} must show both numbers`).toMatch(
          new RegExp(`${DROPPED_KEY}[^\\n]*${held}`)
        );
        expect(run.stderr).toContain(
          'Nothing has been written; the existing ceilings are untouched.'
        );
        expect(run.stderr).toContain('git checkout HEAD');
      }
      const lift = pairs.liftRow;
      expect(lift.head.stderr).toContain(`${RAISED_KEY}: `);
      expect(lift.head.stderr).toContain('999');
      expect(lift.head.stderr).not.toContain('CLEARED');
      // The shadow note is the rescope's own line — projected out of the
      // equivalence comparison, same contract as the artifact bytes leg.
      expect(projectStderr(lift.split.stderr)).toBe(projectStderr(lift.head.stderr));
      expect(pairs.emptyCeilings.head.stderr).toContain('REFUSING to write');
      expect(pairs.seed.head.stderr).toContain('wrote');
    }
  );

  it(
    'MUTATION CONTROL (reflowed diagnostic): one sentence reworded reddens ONLY the stderr leg',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const { pairs } = scenarios();
      withBrokenLeg(
        `${GENERATOR_DIR_REL}paths.mjs`,
        'Nothing has been written; the existing ceilings are untouched.',
        'Nothing has been written - the existing ceilings are untouched.',
        () => {
          const mutant = rerunSplit('dropRow');
          const head = pairs.dropRow.head;
          const diff = differs(head, mutant);
          expect(diff.stderr, 'the wording leg must see a word').toBe(true);
          expect(diff.code, 'the decision is unchanged').toBe(false);
          expect(diff.artifact, 'the bytes are unchanged').toBe(false);
          expect(mutant.code, summary('mutant', mutant)).toBe(1);
          expect(mutant.stderr).toContain('REFUSING to write');
        }
      );
    }
  );
});
