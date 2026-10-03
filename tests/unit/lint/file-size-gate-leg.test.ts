// tests/unit/lint/file-size-gate-leg.test.ts
//
// Slice rid 2026-09-30-cap-unify-01 — the injection control for the
// `fileSizeOverCap` ratchet leg.
//
// WHAT EACH ARM PROVES, AND WHY IT IS WRITTEN THIS WAY
//   - Every arm spawns `.husky/peaks-gate.mjs file-size`: one measurement, one
//     `check`, the same ceiling `repo` mode ratchets, ~1s instead of the 3m06s
//     `repo` mode costs. A test that re-implemented `actual <= ceiling` locally
//     would be asserting about itself, not about the gate — the reason the
//     `silent-warning` mode exists, inherited verbatim.
//   - THE +1 ARM IS THE POINT. A ratchet that has never been watched going red is
//     prose. It hands the leg exactly the ceiling's worth of over-cap files (the
//     before measurement, held), then one more, and requires the row to flip and
//     the process to exit 1. That is the goal's "the new row refuses to grow".
//     Since repair cycle F1 that arm says `--control-arm`: a named-file SUBSET is
//     not the row, and the leg now refuses to report one as if it were.
//   - NO ARM PINS `measured == ceiling`. A freshly seeded row sits AT its ceiling
//     today, and the first split that lands lowers it; the untouched arm therefore
//     asserts `<=`, and the injection arm derives its count from the artifact and
//     its own before/after measurement — the discipline
//     `tests/unit/lint/silent-warning-gate-leg.test.ts` records.
//   - NOTHING IS WRITTEN INTO THE REPO. The fixtures live in `mkdtempSync(tmpdir())`
//     and are handed to the leg as an explicit path list, so a killed run cannot
//     leave an over-cap file behind and poison the next regeneration with a +1
//     ceiling (measured failure mode, QA 2026-09-29).
//   - THE FAIL-CLOSED ARM asks the leg to count a file that is not there. It must
//     REFUSE with exit 1 and print no row — never a `0`, because `0` is what "the
//     whole tree is under the cap" looks like.
//   - THE CEILING IS BOUND TO ITS INPUTS (repair cycle F2). The artifact records the
//     caps, scope dirs, extensions and line convention the census measured when it
//     seeded the number; these arms cross-measure the live census against that
//     record, which is what makes "retire the cap to 800" a RED refusal instead of
//     a smaller green row. The leg's own trip is `fileSizeInputTrips`, and the arm
//     that names it is a wiring assertion — the behaviour is the cross-measurement.
//   - THE REFUSAL COMES AFTER THE NUMBERS (repair cycle 2). A leg that refuses to
//     vouch for a measurement still SHOWS it: `printFileSizeLeg` writes the scope
//     note first and the refusal second, and returns false so the exit code stays 1.
//     The arms for that property are in-process against that one print path, because
//     reaching the mismatch end to end would mean editing the policy or the published
//     baseline — the two things this cycle may not touch to make a test pass.
//
// Dimensions:
//   - render:      the row the leg prints, and the refusal text
//   - behavior:    held / RED / refused, against the real published ceiling
//   - integration: the real gate process, the real census envelope, the real
//                  baseline artifact
//   - a11y:        the exit codes a commit sees (0 held, 1 breach, 1 refusal)

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  BASELINE_PATH,
  CENSUS_TOOL_PATH,
  REPO_ROOT,
  gateModulePaths,
  gateModuleText,
  generatorModulePathsUnder,
  generatorModuleTextUnder,
  overCapFixture,
  runCensus
} from '../standards/_file-size-cap-scan.js';
import {
  FILE_SIZE_CAP_DEFAULT,
  FILE_SIZE_CAP_TESTS,
  FILE_SIZE_LINE_CONVENTION,
  FILE_SIZE_SCOPE_DIRS,
  FILE_SIZE_SCOPE_EXTENSIONS
} from '../../../src/services/scan/file-size-policy.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

declareDimensions(
  'tests/unit/lint/file-size-gate-leg.test.ts',
  ['render', 'behavior', 'integration', 'a11y'],
  []
);

const GATE = join('.husky', 'peaks-gate.mjs');
const SHARED_LEG = join('.husky', 'peaks-gate-file-size.mjs');
const ROW = 'file-size over cap';
const CEILING_KEY = 'fileSizeOverCap';
const CONTROL_ARM = '--control-arm';

const SCRATCH = mkdtempSync(join(tmpdir(), 'peaks-file-size-gate-leg-'));

/** The published artifact, read once per arm — the gate's own input, not a copy. */
type BaselineArtifact = {
  ceilings: Record<string, unknown>;
  fileSizePolicyInputs?: unknown;
  fileSizeLineConvention?: string;
};

function publishedArtifact(): BaselineArtifact {
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as BaselineArtifact;
}

/** The ceiling the gate itself compares against, read off the artifact. */
function publishedCeiling(): number {
  const value = publishedArtifact().ceilings[CEILING_KEY];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(
      `the baseline has no integer ceiling at "${CEILING_KEY}": run node .husky/peaks-gate-baseline.mjs`
    );
  }
  return value;
}

type LegRun = { readonly code: number; readonly out: string };

function runLeg(fileArgs: readonly string[] = [], controlArm = false): LegRun {
  const argv = controlArm ? [CONTROL_ARM, ...fileArgs] : fileArgs;
  try {
    const out = execFileSync('node', [GATE, 'file-size', ...argv], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/** The artifact's own record of what produced the number it ratchets (F2). */
function publishedPolicyInputs(): Record<string, unknown> {
  const artifact = publishedArtifact();
  if (
    artifact.fileSizePolicyInputs === undefined ||
    artifact.fileSizePolicyInputs === null ||
    typeof artifact.fileSizePolicyInputs !== 'object'
  ) {
    throw new Error(
      'the baseline records no fileSizePolicyInputs, so its fileSizeOverCap ceiling is bound to ' +
        'nothing but a line convention — regenerate it with node .husky/peaks-gate-baseline.mjs'
    );
  }
  return artifact.fileSizePolicyInputs as Record<string, unknown>;
}

/** The line convention the ceiling was counted in, as the artifact states it. */
function publishedConvention(): string {
  const value = publishedArtifact().fileSizeLineConvention;
  if (typeof value !== 'string') {
    throw new Error('the baseline records no fileSizeLineConvention');
  }
  return value;
}

function rowFor(out: string): { mark: string; actual: number; ceiling: number } {
  const hit = new RegExp(`^\\s+(✓|✗)\\s+${ROW}\\s+(\\d+)\\s+\\(ceiling (\\d+)\\)`, 'm').exec(out);
  if (hit === null) throw new Error(`no '${ROW}' row in the leg output:\n${out}`);
  return { mark: hit[1] ?? '?', actual: Number(hit[2]), ceiling: Number(hit[3]) };
}

/** `count` over-cap files in OS tmp, as the leg's explicit path list. */
function overCapPaths(count: number): string[] {
  const paths: string[] = [];
  for (let i = 0; i < count; i++) {
    const path = join(SCRATCH, `over-${String(i).padStart(4, '0')}.ts`);
    writeFileSync(path, overCapFixture(FILE_SIZE_CAP_DEFAULT), 'utf8');
    paths.push(path);
  }
  return paths;
}

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

describe('Scenario: behavior — the verdict, against the real ceiling', () => {
  it(
    'when the tree is untouched, should hold the ceiling and exit 0',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const run = runLeg();
      expect(run.out, run.out).toContain('file-size ceiling held');
      expect(run.code).toBe(0);
      const row = rowFor(run.out);
      expect(row.mark, run.out).toBe('✓');
      expect(row.actual, run.out).toBeLessThanOrEqual(row.ceiling);
    }
  );

  it(
    'when one more file than the ceiling exceeds the cap, should turn the leg RED and exit 1',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const ceiling = publishedCeiling();
      // given: exactly the ceiling's worth of over-cap files — the before
      //        measurement, which must still be held.
      const held = runLeg(overCapPaths(ceiling), true);
      expect(held.code, held.out).toBe(0);
      expect(rowFor(held.out).actual).toBe(ceiling);

      // when: one more file crosses the cap
      const breached = runLeg(overCapPaths(ceiling + 1), true);

      // then: the row flips, the breach names the delta, and the exit code is the
      //       one that blocks the commit.
      expect(breached.code).toBe(1);
      expect(rowFor(breached.out).mark).toBe('✗');
      expect(breached.out).toContain(`${ROW}: ${ceiling + 1} > ceiling ${ceiling} (+1)`);
      expect(breached.out).toContain('file-size CONTROL ARM breached');
      expect(breached.out).toContain('do not raise the ceiling');
    }
  );
});

describe('Scenario: behavior — a named-file subset is not the row (repair cycle F1)', () => {
  it(
    'when handed one existing in-scope file with no control-arm flag, should refuse, print no row, and exit 1',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // THE DEFECT THIS ARM KILLS, reproduced 2026-09-30: this exact command printed
      // `✓ file-size over cap 0 (ceiling 174)` and `file-size ceiling held` and
      // exited 0. A run that names one file cannot contain an over-cap file the
      // whole-tree row does not already count, so its `0` was never a measurement
      // of the row — it was the absence of one, reported as a pass.
      const run = runLeg(['src/services/scan/file-size-policy.ts']);
      expect(run.code, run.out).toBe(1);
      expect(run.out).toContain('REFUSING to report the fileSizeOverCap row');
      expect(run.out).toContain('a subset cannot fail a whole-tree row');
      expect(run.out).toContain(CONTROL_ARM);
      expect(run.out).not.toMatch(/[✓✗] file-size over cap/);
      expect(run.out).not.toContain('ceiling held');
    }
  );

  it(
    'when a control arm measures files the policy does not count, should say so and never claim the row',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // The scoped run is still allowed — it is how the +1 arm above works — but it
      // may not speak in the row's voice. The fixtures are OS-tmp paths, outside
      // `git ls-files <policy dirs>`, so this run measures exactly what it names.
      const run = runLeg(overCapPaths(1), true);
      expect(run.code, run.out).toBe(0);
      expect(run.out).toContain('CONTROL ARM');
      expect(run.out).toContain('NOT THE REPO ROW');
      expect(run.out).toContain('Do not read this exit code as the repo holding');
      expect(run.out).not.toContain('file-size ceiling held');
      // The whole-scope `scope note:` line belongs to a run that measured the row.
      expect(run.out).not.toContain('scope note');
    }
  );
});

describe('Scenario: integration — the leg measures the census, not its own idea', () => {
  it(
    'when untouched, the row equals the GATED part of an independent run of the census tool',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const run = runLeg();
      // Rid `2026-10-03-w10-rescope-a`: the row speaks for the ENFORCED part of
      // the census universe, so the expected number is the same envelope cut by
      // the shared partition — `env.overCap` here would pin the OLD contract.
      const { partitionCensusOverCap } = await loadLegModule();
      expect(rowFor(run.out).actual).toBe(partitionCensusOverCap(runCensus()).gated.overCap);
      expect(rowFor(run.out).ceiling).toBe(publishedCeiling());
    }
  );

  it('is wired into both the whole-repo mode and the mode this test spawns', () => {
    // A leg nothing calls enforces nothing — the same wiring-first assertion
    // `lint-file-list-parity.test.ts` makes for `pnpm lint`.
    //
    // POOLED OVER THE GATE'S MODULE SET (rid 2026-10-02-wave9-gate-entry-split): the
    // entry is 1019 raw lines no more — its regions are `.husky/gate/*.mjs`, so
    // `fileSizeLeg(check, c, [])` is in `repo.mjs` and the dispatch in the entry.
    // The set is WALKED, not listed, and `file-size-cap.test.ts` carries the plant
    // and inverse arms that keep the pool honest.
    const gate = gateModuleText();
    expect(gate).toMatch(/fileSizeLeg\(check, c, \[\]\)/);
    expect(gate).toMatch(/mode === 'file-size'/);
    const generator = generatorModuleTextUnder(REPO_ROOT);
    expect(generator).toContain('fileSizeOverCap: size.env.overCap');
  });

  it('spawns the census through ONE measurement path, not a copy per caller (repair cycle F5)', () => {
    // The guard used to exist twice, near-verbatim, already drifted on `windowsHide`.
    // A ceiling and the row that checks it must not be two pieces of code that
    // happen to agree, so neither caller may spawn the census itself any more.
    const shared = readFileSync(join(REPO_ROOT, SHARED_LEG), 'utf8');
    expect(shared).toContain(CENSUS_TOOL_PATH);
    // Every module the gate is made of — walked, not listed — plus the generator. The
    // split made the single-file caller a module SET, so the prohibition widened to
    // match it: no part of the gate may spawn the census or re-define the measurement.
    // Every module the gate is made of — walked, not listed — plus every module the
    // GENERATOR is made of. The two splits made each single-file caller a module SET, so
    // the prohibition widened to match both: no part of either may spawn the census or
    // re-define the measurement.
    for (const caller of [...gateModulePaths(), ...generatorModulePathsUnder(REPO_ROOT)]) {
      const text = readFileSync(join(REPO_ROOT, caller), 'utf8');
      // Neither caller may spawn the census itself any more: the shared module is
      // the only place `TSX_CLI, FS_CENSUS` appears. (`--json` on its own is not
      // the tell — the silent-warning detector is spawned the same way.)
      expect(text, caller).not.toMatch(/TSX_CLI,\s*FS_CENSUS/);
      expect(text, caller).not.toMatch(/function measureFileSizeOverCap/);
    }
    // And the shared module IS reached: by the gate somewhere in its set (whichever
    // module owns the leg now), and by the generator by name.
    expect(gateModuleText()).toContain('peaks-gate-file-size.mjs');
    expect(generatorModuleTextUnder(REPO_ROOT)).toContain('peaks-gate-file-size.mjs');
  });

  it('binds the ceiling to the inputs that produced it (repair cycle F2)', () => {
    // MEASURED, not asserted: the census re-run in this very test is the leg's own
    // re-derivation, and the artifact is what it compares against. Re-deciding the
    // cap, the dirs or the extensions without re-seeding moves one side and not the
    // other, and `fileSizeInputTrips` (called by `fileSizeLeg`) turns that into a
    // refusal instead of a smaller green row — the hole where 800/800 read as
    // "40, ceiling 174, held".
    const recorded = publishedPolicyInputs();
    const env = runCensus();
    expect(env.scope.source).toBe('git ls-files <policy dirs>');
    expect(recorded.defaultCap).toBe(env.caps.defaultCap);
    expect(recorded.testsCap).toBe(env.caps.testsCap);
    expect(recorded.scopeDirs).toEqual([...env.scope.dirs]);
    expect(recorded.scopeExtensions).toEqual([...env.scope.extensions]);
    expect(publishedConvention()).toBe(env.convention);
    // The live policy is the third reader: an artifact that agrees with a stale
    // census but not with the module is still a stale artifact.
    expect(recorded.defaultCap).toBe(FILE_SIZE_CAP_DEFAULT);
    expect(recorded.testsCap).toBe(FILE_SIZE_CAP_TESTS);
    expect(recorded.scopeDirs).toEqual([...FILE_SIZE_SCOPE_DIRS]);
    expect(recorded.scopeExtensions).toEqual([...FILE_SIZE_SCOPE_EXTENSIONS]);
    expect(env.convention).toBe(FILE_SIZE_LINE_CONVENTION);
    // Pooled: the input binding is checked inside the file-size leg, and the leg is
    // `.husky/gate/legs.mjs` as of rid `2026-10-02-wave9-gate-entry-split`.
    expect(gateModuleText()).toContain('fileSizeInputTrips(');
  });
});

describe('Scenario: a11y — a census that cannot run is a failure, never a zero', () => {
  it(
    'when handed a path that does not exist, should refuse with exit 1 and print no row',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const run = runLeg([join(SCRATCH, 'not-there.ts')], true);
      expect(run.code).toBe(1);
      expect(run.out).toContain('REFUSING to measure the file-size leg');
      expect(run.out).toContain('gate FAILURE, not a zero');
      expect(run.out).not.toContain(`✓ ${ROW}`);
      expect(run.out).not.toContain('ceiling held');
    }
  );

  it('names the leg, the count and the ceiling in the row it prints', () => {
    const run = runLeg();
    const row = rowFor(run.out);
    expect(run.out).toContain(ROW);
    expect(row.ceiling).toBe(publishedCeiling());
    // The scope note is what makes the number checkable from the log alone.
    expect(run.out).toContain('git ls-files <policy dirs>');
    expect(run.out).toContain('excess lines');
  });
});

// ---------------------------------------------------------------------------
// THE ORDER THE LEG SPEAKS (repair cycle 2, rid 2026-09-30-cap-unify-01)
// ---------------------------------------------------------------------------
// Cycle 1's refusal paths checked `size.refusal !== null` and returned BEFORE the
// envelope line was written. The run that trips the policy-input binding — the one
// that fires exactly when someone re-decides the cap under a ceiling — therefore
// printed exit 1 and NO numbers: not the caps it measured, not the count, not how
// many files it looked at. A refusal that swallows the measurement it is refusing
// to vouch for is unreviewable in the same way a gate that vouches for what it
// cannot see is, so the leg now prints what it measured and refuses after.
//
// WHY AN IN-PROCESS ARM. The mismatch is unreachable in a real run of the real gate
// without editing either the policy module or the published baseline — the two
// things a repair cycle may not touch to make a test pass (and writing a fixture
// into the repo is the failure mode this file's header already refuses: "NOTHING IS
// WRITTEN INTO THE REPO"). `printFileSizeLeg` is the ONE print path both gate modes
// call, so the order is asserted where it lives and the wiring arm below shows the
// gate routes through it rather than re-spelling it.

/** The part of the shared leg these arms call, typed for the same reason the parity test types its loader. */
type FileSizeLegModule = {
  describeInputTrips(trips: readonly string[]): string;
  // Property, not method signature: ~L265 destructures it; `unbound-method` flags method-typed refs (rescope repair 1).
  partitionCensusOverCap: (env: unknown) => { gated: { overCap: number; excessLines: number } };
  printFileSizeLeg(
    size: {
      readonly refusal: string | null;
      readonly envelope: Record<string, unknown> | null;
      readonly controlArm: boolean;
    },
    ceiling: number,
    write: (stream: string, text: string) => void
  ): boolean;
};

async function loadLegModule(): Promise<FileSizeLegModule> {
  return (await import(pathToFileURL(join(REPO_ROOT, SHARED_LEG)).href)) as FileSizeLegModule;
}

/** A whole-scope census envelope counted under caps the ceiling was NOT seeded under (800/800, F2's attack). */
function trippedEnvelope(): Record<string, unknown> {
  return {
    convention: 'split-newline',
    caps: { defaultCap: 800, testsCap: 800 },
    scope: { source: 'git ls-files <policy dirs>', countedFiles: 1429 },
    overCap: 40,
    excessLines: 9128,
    byDir: { src: { files: 31, excessLines: 8000 }, scripts: { files: 9, excessLines: 1128 } }
  };
}

/** Collect what the leg wrote, as `stream text` pairs, so the ORDER is the observable. */
function legWrites(
  module: FileSizeLegModule,
  size: Parameters<FileSizeLegModule['printFileSizeLeg']>[0],
  ceiling: number
): { readonly lines: string[]; readonly held: boolean } {
  const lines: string[] = [];
  const held = module.printFileSizeLeg(size, ceiling, (stream, text) =>
    lines.push(`${stream} ${text}`)
  );
  return { lines, held };
}

describe('Scenario: behavior — the leg prints what it measured, then refuses (repair cycle 2)', () => {
  it(
    'when the policy-input binding trips, should write the scope note before the refusal and still refuse',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const module = await loadLegModule();
      const refusal = module.describeInputTrips([
        'default cap: ceiling seeded under 300, this census measured 800'
      ]);
      const { lines, held } = legWrites(
        module,
        { refusal, envelope: trippedEnvelope(), controlArm: false },
        publishedCeiling()
      );
      // `held === false` is what both callers turn into `return 1`: the exit code is
      // unchanged by the fix, only the silence before it is.
      expect(held, lines.join('\n')).toBe(false);
      expect(lines[0], lines.join('\n')).toContain('scope note');
      // The evidence has to be the numbers that made it refuse — the caps it ran
      // under and the count it produced — or the line proves nothing.
      expect(lines[0]).toContain('against caps 800/800');
      expect(lines[0]).toContain('40 over cap');
      expect(lines[0]).toContain('1429 file(s)');
      const refusedAt = lines.findIndex((line) => line.includes('REFUSING to compare'));
      expect(refusedAt, lines.join('\n')).toBeGreaterThan(0);
      expect(lines[refusedAt]).toContain('default cap: ceiling seeded under 300');
      expect(lines.join('\n')).not.toContain('ceiling held');
    }
  );

  it(
    'when the census could not run at all, should refuse alone and invent no scope note',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // The other half of the same rule: "print what you measured" must not become
      // "print a measurement". A null envelope is a run that saw nothing — and this
      // arm is the real gate process, not a stand-in for it.
      const run = runLeg([join(SCRATCH, 'never-written.ts')], true);
      expect(run.code, run.out).toBe(1);
      expect(run.out).toContain('REFUSING to measure the file-size leg');
      expect(run.out).not.toContain('scope note');
      expect(run.out).not.toContain('ceiling held');
    }
  );

  it('is the one print path both gate modes call, and stays loadable from a copy of the gate', () => {
    // ORDER IS ONLY FIXED IF BOTH MODES USE THE FIX. `repo` mode and `file-size`
    // mode each used to print the refusal their own way; a per-caller copy of the
    // order is the drift repair cycle F5 was opened to end.
    //
    // POOLED OVER THE GATE'S MODULE SET: the two callers are now `repo.mjs` and
    // `modes.mjs`, so "exactly two" is a property of the set, not of one file.
    const gate = gateModuleText();
    expect(gate.match(/printFileSizeLeg\(size/g) ?? []).toHaveLength(2);
    expect(gate).not.toMatch(/size\.refusal !== null\)[\s\S]{0,80}describeFileSizeEnvelope/);
    // And the helper is reached by a specifier a COPY of the gate can resolve: the
    // parity test runs `repo` mode from a scratch file under `.tmp/`, and a `./`
    // sibling import made that copy die at load with ERR_MODULE_NOT_FOUND, so its
    // CONTROL arm could only ever report "the gate exited (1) before printing its
    // scope line" instead of the weakened count it exists to catch. The split made
    // the entry itself a file with siblings, so the same rule now binds the entry's
    // OWN region imports: anchored at the repo root, never `./gate/…`.
    expect(gate).toMatch(/from '\.\.(?:\/\.\.)*\/\.husky\/peaks-gate-file-size\.mjs'/);
    expect(gate).not.toMatch(/from '\.\/peaks-gate-file-size\.mjs'/);
    const entry = readFileSync(join(REPO_ROOT, GATE), 'utf8');
    expect(entry).toContain("from '../.husky/gate/");
    expect(entry).not.toMatch(/from '\.\/gate\//);
  });
});
