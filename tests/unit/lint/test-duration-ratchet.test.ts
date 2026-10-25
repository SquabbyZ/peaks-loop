// tests/unit/lint/test-duration-ratchet.test.ts
//
// The unit suite's wall-clock CEILING: the decision table and the report reader — the PURE
// half of `.husky/test-duration-ratchet.mjs`.
//
// WHY THIS FILE EXISTS. A ratchet whose trip has not been demonstrated is not a ratchet. CI
// cannot be observed from here, so the failure direction is proven the way this repository
// proves every gate that has one: the decision is a PURE MODULE with a thin runner
// (`.husky/test-duration-ratchet/{ceiling,report}.mjs`), so a unit test can watch it go red
// without paying for a fourteen-minute suite run. The pattern is `.husky/coverage-ratchet/`'s.
//
// THE INCLUSIVE BOUNDARY IS PINNED HERE, NOT ASSUMED. `measured === ceiling` HOLDS (arm B):
// `--tighten` writes `measured + margin`, and a ratchet that went red at exactly the value
// it just wrote would be red on arrival, which is the failure this gate exists to avoid.
//
// THE POPULATION IS PINNED BY SIZE AS WELL AS BY NAME (arm J). Without the size, a report
// holding one file out of six hundred and twenty-nine is timed and read green — the hole a
// review found in the sibling coverage floor.
//
// `effectiveMaxWorkers` IS A SECOND COPY OF A DECISION, SO IT IS PINNED AGAINST THE
// ORIGINAL (arm V). `.husky/**` is plain `.mjs` and cannot import the repository's
// TypeScript, so `vitest.workers.ts`'s `parseOverride` has a twin. The test drives BOTH under
// the same environment values and requires them to agree.
//
// Dimensions covered:
//   - behavior:    the decision table, the artifact shape, the tighten guard, the HEAD anchor
//   - render:      the report reader's return shape and the measuring arguments
//   - integration: the tracked artifact read off disk, and the real policy module re-evaluated
//   - a11y:        the operator-facing sentences a reader has to act on

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CEILING_REL = '.peaks/lint/test-duration-ceiling.json';
const WORKER_ENV = 'PEAKS_VITEST_MAX_WORKERS';

type CeilingArtifact = {
  version: number;
  ceiling: { wallSeconds: number; maxWorkers: number };
  population: { glob: string; source: string; files: number };
  measured: {
    wallSeconds: number;
    testFiles: number;
    testCases: number;
    measuredOn: string;
    measuredAt: string;
  };
  generatedAt: string;
  command: string;
};

type TightenMeasurement = {
  wallSeconds: number;
  testFiles: number;
  testCases: number;
  maxWorkers: number;
  measuredOn: string;
  measuredAt: string;
  command: string;
};

type CeilingModule = {
  CEILING_PATH: string;
  POPULATION_GLOB: string;
  CEILING_MARGIN_SECONDS: number;
  DEFAULT_MAX_WORKERS: number;
  ceilingProblems(document: unknown, options: { population: string }): string[];
  compare(input: { measuredWallSeconds: number; wallSeconds: number }): {
    ok: boolean;
    marginSeconds: number;
    line: string;
  };
  tightenedCeiling(measuredWallSeconds: number): number;
  tightenedArtifact(document: CeilingArtifact, measurement: TightenMeasurement): CeilingArtifact;
  tightenRefusal(input: { measuredWallSeconds: number; wallSeconds: number }): string | null;
  looseningRefusal(input: {
    head: CeilingArtifact | null;
    working: CeilingArtifact;
    allowLoosen: boolean;
  }): string | null;
  unaccountedProblem(input: {
    reportFiles: number;
    populationFiles: number;
    population: string;
  }): string | null;
  effectiveMaxWorkers(env: { PEAKS_VITEST_MAX_WORKERS?: string | undefined }): number;
};

type ReportModule = {
  REPORT_PATH: string;
  measureArgs(outputFile: string): string[];
  readReport(
    text: string,
    options: { root: string }
  ): {
    problem: string | null;
    files: number;
    testCases: number;
    wallSeconds: number | null;
    foreign: string[];
  };
};

declareDimensions(
  'tests/unit/lint/test-duration-ratchet.test.ts',
  ['behavior', 'render', 'integration', 'a11y'],
  []
);

let ceiling: CeilingModule;
let report: ReportModule;
/** The artifact this repository tracks, read off disk rather than restated here. */
let artifact: CeilingArtifact;

beforeAll(async () => {
  const load = async (parts: readonly string[]): Promise<unknown> =>
    await import(pathToFileURL(join(REPO_ROOT, ...parts)).href);
  ceiling = (await load(['.husky', 'test-duration-ratchet', 'ceiling.mjs'])) as CeilingModule;
  report = (await load(['.husky', 'test-duration-ratchet', 'report.mjs'])) as ReportModule;
  artifact = JSON.parse(readFileSync(join(REPO_ROOT, CEILING_REL), 'utf8')) as CeilingArtifact;
});

/** A vitest JSON report over a chosen set of files, at a chosen wall clock. */
function fixtureReport(files: ReadonlyArray<{ name: string; endTime: number }>): string {
  const startTime = 1_000_000;
  return JSON.stringify({
    numTotalTestSuites: files.length,
    numTotalTests: 7,
    startTime,
    success: true,
    testResults: files.map((file) => ({
      assertionResults: [],
      startTime,
      endTime: file.endTime,
      status: 'passed',
      message: '',
      name: file.name
    }))
  });
}

/**
 * The worker count the TypeScript policy resolves under one environment value.
 *
 * The policy module is evaluated ONCE per module registry, so every later case would read
 * the FIRST value and the override assertions below would pass vacuously. `resetModules`
 * clears the registry between cases and `stubEnv(name, undefined)` DELETES the key, which
 * is the only shape that reaches `parseOverride` as `undefined`.
 */
async function policyWorkers(override: string | undefined): Promise<number> {
  vi.resetModules();
  vi.stubEnv(WORKER_ENV, override);
  try {
    const policy = await import('../../../vitest.workers.js');
    return policy.maxWorkers;
  } finally {
    vi.unstubAllEnvs();
  }
}

/**
 * The REAL runner, spawned, against a report on disk. The pure modules are proven above;
 * this proves the RUNNER wires them to the exit codes the contract names, and that it never
 * reaches 0 for a report that says nothing. `--report` measures nothing, so the arm costs
 * no suite run.
 */
function runRunner(reportPath: string): { code: number; out: string } {
  const result = spawnSync(
    process.execPath,
    [join(REPO_ROOT, '.husky', 'test-duration-ratchet.mjs'), '--report', reportPath],
    { cwd: REPO_ROOT, encoding: 'utf8', windowsHide: true }
  );
  if (result.error !== undefined) throw result.error;
  return { code: result.status ?? 1, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('Scenario: behavior — the decision table holds at the ceiling and refuses a slower suite', () => {
  it('A: should HOLD when the measured wall clock is under the ceiling', () => {
    // given: a measured wall clock under the ceiling the artifact records
    // when: the two are compared
    // then: the comparison holds and reports the margin
    const verdict = ceiling.compare({ measuredWallSeconds: 100, wallSeconds: 2700 });
    expect(verdict.ok).toBe(true);
    expect(verdict.marginSeconds).toBe(2600);
  });

  it('B: should HOLD when the measured wall clock equals the ceiling — the boundary is inclusive', () => {
    // given: a measured wall clock exactly equal to the ceiling
    // when: the two are compared
    // then: the comparison holds, because a ratchet set at the value it wrote must not go red
    const verdict = ceiling.compare({ measuredWallSeconds: 2700, wallSeconds: 2700 });
    expect(verdict.ok).toBe(true);
    expect(verdict.marginSeconds).toBe(0);
  });

  it('C: should FAIL when the measured wall clock is over the ceiling', () => {
    // given: a measured wall clock over the ceiling
    // when: the two are compared
    // then: the comparison fails and the margin is negative
    const verdict = ceiling.compare({ measuredWallSeconds: 3000, wallSeconds: 2700 });
    expect(verdict.ok).toBe(false);
    expect(verdict.marginSeconds).toBe(-300);
  });

  it('D: should refuse an artifact that is not a JSON object', () => {
    // given: a document that is not an object at all
    // when: the artifact shape is checked
    // then: the shape is refused, and the refusal names what it found
    expect(ceiling.ceilingProblems(null, { population: 'tests/unit' }).join(' ')).toContain('null');
  });

  it('E: should refuse an artifact whose version is not 1', () => {
    // given: an artifact carrying a version this reader does not know
    // when: the artifact shape is checked
    // then: the shape is refused, and the refusal names the version it found
    const broken = { ...artifact, version: 2 };
    expect(
      ceiling.ceilingProblems(broken, { population: ceiling.POPULATION_GLOB }).join(' ')
    ).toContain('version');
  });

  it('F: should refuse an artifact whose ceiling is not a positive number of seconds', () => {
    // given: a ceiling of zero seconds, which no measurement could ever breach
    // when: the artifact shape is checked
    // then: the shape is refused, and the refusal names the field
    const broken = { ...artifact, ceiling: { ...artifact.ceiling, wallSeconds: 0 } };
    expect(
      ceiling.ceilingProblems(broken, { population: ceiling.POPULATION_GLOB }).join(' ')
    ).toContain('wallSeconds');
  });

  it('G: should refuse an artifact whose concurrency key is not a positive whole number', () => {
    // given: a concurrency key of zero workers
    // when: the artifact shape is checked
    // then: the shape is refused, and the refusal names the field
    const broken = { ...artifact, ceiling: { ...artifact.ceiling, maxWorkers: 0 } };
    expect(
      ceiling.ceilingProblems(broken, { population: ceiling.POPULATION_GLOB }).join(' ')
    ).toContain('maxWorkers');
  });

  it('H: should refuse an artifact whose population count is not a positive whole number', () => {
    // given: a population recorded as zero files
    // when: the artifact shape is checked
    // then: the shape is refused, because the population would be pinned by name only
    const broken = { ...artifact, population: { ...artifact.population, files: 0 } };
    expect(
      ceiling.ceilingProblems(broken, { population: ceiling.POPULATION_GLOB }).join(' ')
    ).toContain('population.files');
  });

  it('I: should refuse an artifact that names a population this gate does not measure', () => {
    // given: an artifact whose population glob is not the one this ratchet measures
    // when: the artifact shape is checked
    // then: the shape is refused, so the duplicate spelling cannot drift unobserved
    const broken = { ...artifact, population: { ...artifact.population, glob: 'src/**' } };
    expect(
      ceiling.ceilingProblems(broken, { population: ceiling.POPULATION_GLOB }).join(' ')
    ).toContain('population.glob');
  });

  it('J: should refuse a report that accounts for fewer files than the population records', () => {
    // given: a report holding one file of a population of six hundred and twenty-nine
    // when: the account is checked
    // then: the report is refused, because a subset is not a measurement of the population
    const problem = ceiling.unaccountedProblem({
      reportFiles: 1,
      populationFiles: 629,
      population: ceiling.POPULATION_GLOB
    });
    expect(problem).not.toBeNull();
    expect(problem).toContain('SUBSET');
    expect(problem).toContain('629');
  });

  it('K: should accept a report that accounts for at least as many files as the population records', () => {
    // given: a report holding exactly the population, and one holding more
    // when: the account is checked
    // then: both are accepted, because the count is a floor and new files join the suite
    const at = { populationFiles: 629, population: ceiling.POPULATION_GLOB };
    expect(ceiling.unaccountedProblem({ ...at, reportFiles: 629 })).toBeNull();
    expect(ceiling.unaccountedProblem({ ...at, reportFiles: 700 })).toBeNull();
  });

  it('L: should write a tightened ceiling of the measurement plus the stated margin', () => {
    // given: a measured wall clock
    // when: the tightened ceiling is computed
    // then: it is the measurement plus the margin, rounded up to a whole second
    expect(ceiling.tightenedCeiling(500)).toBe(800);
    expect(ceiling.tightenedCeiling(500)).toBe(500 + ceiling.CEILING_MARGIN_SECONDS);
  });

  it('M: should refuse to write a ceiling looser than the one already on disk', () => {
    // given: a measurement that would write a ceiling above the ceiling on disk
    // when: the tightening is checked
    // then: it is refused, because the tool may not relax the bar
    const refusal = ceiling.tightenRefusal({ measuredWallSeconds: 5000, wallSeconds: 2700 });
    expect(refusal).not.toBeNull();
    expect(refusal).toContain('LOOSER');
    expect(refusal).toContain('2700');
  });

  it('N: should refuse a working ceiling that is looser than the one HEAD records', () => {
    // given: HEAD recording a tighter ceiling than the working copy
    // when: the two are compared
    // then: the comparison is refused, because a ceiling may only fall
    const head = { ...artifact, ceiling: { ...artifact.ceiling, wallSeconds: 2700 } };
    const working = { ...artifact, ceiling: { ...artifact.ceiling, wallSeconds: 7200 } };
    const refusal = ceiling.looseningRefusal({ head, working, allowLoosen: false });
    expect(refusal).not.toBeNull();
    expect(refusal).toContain('7200');
    expect(refusal).toContain('2700');
  });

  it('O: should accept a working ceiling that is tighter than HEAD, and let --loosen name a relaxation', () => {
    // given: HEAD recording a tighter ceiling, and a working copy that is tighter still
    // when: the two are compared with and without the explicit flag
    // then: the tightening passes, and only `--loosen` lets the relaxation through
    const head = { ...artifact, ceiling: { ...artifact.ceiling, wallSeconds: 2700 } };
    const tighter = { ...artifact, ceiling: { ...artifact.ceiling, wallSeconds: 1800 } };
    const looser = { ...artifact, ceiling: { ...artifact.ceiling, wallSeconds: 7200 } };
    expect(ceiling.looseningRefusal({ head, working: tighter, allowLoosen: false })).toBeNull();
    expect(ceiling.looseningRefusal({ head, working: looser, allowLoosen: true })).toBeNull();
    expect(ceiling.looseningRefusal({ head, working: looser, allowLoosen: false })).not.toBeNull();
  });
});

describe('Scenario: render — the report reader turns a vitest report into data', () => {
  it('P: should read a complete report into its file count, case count and wall clock', () => {
    // given: a vitest JSON report over two files of the population
    // when: the reader parses it
    // then: it returns the file count, the case count and the wall clock
    const text = fixtureReport([
      { name: `${REPO_ROOT}/tests/unit/lint/a.test.ts`, endTime: 1_000_300 },
      { name: `${REPO_ROOT}/tests/unit/lint/b.test.ts`, endTime: 1_000_100 }
    ]);
    const result = report.readReport(text, { root: REPO_ROOT });
    expect(result.problem).toBeNull();
    expect(result.files).toBe(2);
    expect(result.testCases).toBe(7);
    expect(result.wallSeconds).toBe(0.3);
    expect(result.foreign).toEqual([]);
  });

  it('Q: should refuse a report that is empty, unparseable, or lists no file at all', () => {
    // given: three degenerate reports
    // when: the reader parses each of them
    // then: each is refused, and none of them reads as a zero-second suite
    const options = { root: REPO_ROOT };
    expect(report.readReport('', options).problem).toContain('empty');
    expect(report.readReport('{ not json', options).problem).toContain('not parseable JSON');
    expect(
      report.readReport('{"startTime":1,"numTotalTests":1,"testResults":[]}', options).problem
    ).toContain('no test file');
  });

  it('R: should refuse a report with no numeric startTime, because an untimed run cannot be compared', () => {
    // given: a report whose startTime is not a number
    // when: the reader parses it
    // then: it is refused rather than timed against nothing
    const text = JSON.stringify({
      startTime: 'soon',
      numTotalTests: 1,
      testResults: [{ name: 'x', endTime: 1 }]
    });
    expect(report.readReport(text, { root: REPO_ROOT }).problem).toContain('startTime');
  });

  it('S: should name a file outside the population, and still count every row it read', () => {
    // given: a report holding one file of the population and one outside it
    // when: the reader parses it
    // then: the foreign file is named and the file count still reports every row
    const text = fixtureReport([
      { name: `${REPO_ROOT}/tests/unit/lint/a.test.ts`, endTime: 1_000_300 },
      { name: `${REPO_ROOT}/packages/peaks-loop-mut/src/x.ts`, endTime: 1_000_100 }
    ]);
    const result = report.readReport(text, { root: REPO_ROOT });
    expect(result.foreign.length).toBe(1);
    expect(result.foreign[0]).toContain('packages/peaks-loop-mut');
    expect(result.files).toBe(2);
  });

  it('T: should ask vitest for the json reporter and name the output file per reporter', () => {
    // given: the measuring command
    // when: its arguments are composed
    // then: they name the json reporter and its per-reporter output file
    const args = report.measureArgs('coverage/report.json');
    expect(args).toContain('--reporter=json');
    expect(args).toContain('--outputFile.json=coverage/report.json');
  });
});

describe('Scenario: integration — the tracked artifact and the real policy module', () => {
  it('U: should read a tracked artifact whose shape this gate accepts', () => {
    // given: the artifact this repository tracks
    // when: its shape is checked against the population this gate measures
    // then: it is accepted, and its ceiling and population are positive numbers
    expect(ceiling.ceilingProblems(artifact, { population: ceiling.POPULATION_GLOB })).toEqual([]);
    expect(artifact.ceiling.wallSeconds).toBeGreaterThan(0);
    expect(artifact.ceiling.maxWorkers).toBeGreaterThan(0);
    expect(artifact.population.files).toBeGreaterThan(0);
  });

  it('V: should agree with `vitest.workers.ts` on every environment value — two copies of one decision', async () => {
    // given: each environment shape `parseOverride` has to answer for, illegal ones included
    // when: the TypeScript policy module and the `.mjs` copy are each evaluated under it
    // then: they resolve the same worker count, so the copy cannot drift unobserved
    for (const raw of [undefined, '', '  ', '0', '-2', 'abc', '3.7', '4', '  6  ']) {
      const policy = await policyWorkers(raw);
      const copy = ceiling.effectiveMaxWorkers({ PEAKS_VITEST_MAX_WORKERS: raw });
      expect(copy, `PEAKS_VITEST_MAX_WORKERS=${String(raw)}`).toBe(policy);
    }
  });

  it('W: should make the real runner REFUSE a subset report with exit 1, never exit 0', () => {
    // given: a report holding one file of a population of six hundred and twenty-nine
    // when: the real runner is spawned against it
    // then: it exits 1 and names the shortfall, so "nothing measured" can never read as green
    const dir = mkdtempSync(join(tmpdir(), 'peaks-duration-ratchet-'));
    try {
      const path = join(dir, 'report.json');
      writeFileSync(
        path,
        fixtureReport([{ name: `${REPO_ROOT}/tests/unit/lint/a.test.ts`, endTime: 1_000_300 }]),
        'utf8'
      );
      const result = runRunner(path);
      expect(result.code, `the runner said:\n${result.out}`).toBe(1);
      expect(result.out).toContain('SUBSET');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('X: should raise the population floor to the measured file count when it tightens', () => {
    // given: the tracked artifact, whose population floor is the seeded file count
    // when: it is tightened against a measurement of seven hundred files
    // then: the floor moves to 700 — a floor left at the seed lets a SUBSET report read green
    //       once the suite grows — and the ceiling is the measurement plus the margin
    const next = ceiling.tightenedArtifact(artifact, {
      wallSeconds: 500,
      testFiles: 700,
      testCases: 8000,
      maxWorkers: artifact.ceiling.maxWorkers,
      measuredOn: 'win32',
      measuredAt: '2026-10-25T00:00:00.000Z',
      command: 'node .husky/test-duration-ratchet.mjs --tighten'
    });
    expect(next.population.files).toBe(700);
    expect(next.population.glob).toBe(artifact.population.glob);
    expect(next.population.source).toBe(artifact.population.source);
    expect(next.ceiling.wallSeconds).toBe(500 + ceiling.CEILING_MARGIN_SECONDS);
    expect(next.ceiling.maxWorkers).toBe(artifact.ceiling.maxWorkers);
    expect(ceiling.ceilingProblems(next, { population: ceiling.POPULATION_GLOB })).toEqual([]);
  });
});

describe('Scenario: a11y — the sentences a reader has to act on', () => {
  it('Y: should name the measurement, the ceiling and the breach in the verdict', () => {
    // given: a measurement over the ceiling
    // when: the verdict line is rendered
    // then: it names both numbers, so the reader does not have to compute the margin
    const line = ceiling.compare({ measuredWallSeconds: 3000, wallSeconds: 2700 }).line;
    expect(line).toContain('BREACHED');
    expect(line).toContain('3000');
    expect(line).toContain('2700');
  });

  it('Z: should name the artifact and the flag that changes the outcome in every refusal', () => {
    // given: the three refusals this gate can print
    // when: they are rendered
    // then: each names the artifact or the flag a reader has to reach for
    expect(ceiling.tightenRefusal({ measuredWallSeconds: 5000, wallSeconds: 2700 })).toContain(
      'REFUSING'
    );
    expect(
      ceiling.looseningRefusal({
        head: artifact,
        working: { ...artifact, ceiling: { ...artifact.ceiling, wallSeconds: 7200 } },
        allowLoosen: false
      })
    ).toContain('--loosen');
    expect(
      ceiling.unaccountedProblem({
        reportFiles: 1,
        populationFiles: 629,
        population: ceiling.POPULATION_GLOB
      })
    ).toContain('629');
  });
});
