// tests/unit/lint/coverage-ratchet.test.ts
//
// The coverage FLOOR's decision table and its report reader — the PURE half.
//
// WHY THIS FILE EXISTS. A ratchet whose trip has not been demonstrated is not a ratchet. CI cannot be
// observed from here, so the failure direction is proven the way this repository proves every gate
// that has one: the comparison is a PURE MODULE with a thin runner
// (`.husky/coverage-ratchet/floor.mjs`, `.husky/coverage-ratchet/report.mjs`), so a unit test can
// watch it go red without paying for a ~12-minute coverage run. The pattern is `.husky/monotonic/*`'s,
// and the reason is `peaks-gate.mjs`'s own header: a leg "exists so a unit test can inject a swallow
// and watch THIS leg go red".
//
// THE INCLUSIVE BOUNDARY IS PINNED HERE, NOT ASSUMED. `measured === floor` HOLDS (arm B). It has to:
// `--raise` writes `measured - margin`, and a ratchet that went red at exactly the value it wrote
// would be red on arrival, which is the failure this whole gate exists to avoid.
//
// THE POPULATION IS PINNED BY SIZE AS WELL AS BY NAME. Arms W/X/Y are the regression arms for the
// hole a review found: a report holding a strict SUBSET of `src/**` read `HELD` and exited 0, because
// the reader refused a WRONG row but had no counterpart for a merely FEW.
//
// THE RUNNER'S OWN ARMS LIVE IN `coverage-ratchet-runner.test.ts`, split out because the battery
// crossed the 500-line `tests/**` cap. The harness both files share is
// `_coverage-ratchet-fixture.ts`.
//
// Dimensions covered:
//   - render:      the verdict object and the report reader's return shape (count, percentage,
//                  foreign rows) — asserted as data, not only as sentences
//   - behavior:    the decision table, the raise guard, the lowering guard, the account check
//   - integration: the real tracked artifact is read off disk, and the real runner is spawned
//   - a11y:        the operator-facing sentences and the process exit code

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import {
  FLOOR_ABS,
  REPO_ROOT,
  type FloorModule,
  type ReportModule,
  fixtureReport,
  fullReport,
  loadModules,
  ratchet,
  trackedFloor,
  trackedSourceKeys,
  withReport
} from './_coverage-ratchet-fixture.js';

declareDimensions(
  'tests/unit/lint/coverage-ratchet.test.ts',
  ['render', 'behavior', 'integration', 'a11y'],
  []
);

let floor: FloorModule;
let report: ReportModule;
/** The floor the real artifact records, and the bytes it holds — read, never restated. */
let trackedFloorPct = 0;
let trackedRows = 0;
let trackedBytes = '';
/** Every tracked file under `src/`: the population a report has to ACCOUNT FOR. */
let population: string[] = [];
/** Two real `src/**` keys, so the reader's own path test is exercised on real paths. */
let srcKeys: string[] = [];

beforeAll(async () => {
  ({ floor, report } = await loadModules());
  ({ linesPct: trackedFloorPct, files: trackedRows, bytes: trackedBytes } = trackedFloor());
  population = trackedSourceKeys();
  srcKeys = population.slice(0, 2);

  // Every arm below derives its numbers from these, so a vacuous fixture would make them
  // vacuous too rather than red.
  expect(Number.isFinite(trackedFloorPct), 'the tracked floor names no linesPct').toBe(true);
  expect(Number.isInteger(trackedRows), 'the tracked floor names no row count').toBe(true);
  expect(population.length, 'no tracked src files to populate the fixture with').toBeGreaterThan(
    100
  );
  expect(
    population.length,
    'the fixture is smaller than the sheet it stands in for'
  ).toBeGreaterThanOrEqual(trackedRows);
  expect(srcKeys.length).toBe(2);
});

describe('Scenario: behavior — the decision table refuses a drop and holds at the floor', () => {
  it('A: measured below the floor FAILS and names both numbers', () => {
    const verdict = floor.compare({
      measuredPct: trackedFloorPct - 0.1,
      linesPct: trackedFloorPct
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.line).toContain('BREACHED');
    expect(verdict.line).toContain(String(trackedFloorPct));
    expect(verdict.marginPp).toBeCloseTo(-0.1, 10);
  });

  it('B: measured exactly AT the floor HOLDS — the boundary is inclusive', () => {
    const verdict = floor.compare({ measuredPct: trackedFloorPct, linesPct: trackedFloorPct });
    expect(verdict.ok, `the floor must be inclusive at ${trackedFloorPct}`).toBe(true);
    expect(verdict.line).toContain('HELD');
    expect(verdict.marginPp).toBe(0);
  });

  it('C: measured ABOVE the floor HOLDS and reports the margin', () => {
    const verdict = floor.compare({
      measuredPct: trackedFloorPct + 0.1,
      linesPct: trackedFloorPct
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.line).toContain('HELD');
    expect(verdict.marginPp).toBeCloseTo(0.1, 10);
  });

  it('D: a breach a hair below the floor reads as a sentence, not "47% is BELOW 47% by 0 pp"', () => {
    // Two-decimal rendering made this line nonsense on the measurement a human reads: 46.999
    // stringified to "47", so the sentence contradicted its own exit code.
    const verdict = floor.compare({ measuredPct: 46.999, linesPct: 47.0 });
    expect(verdict.ok).toBe(false);
    expect(verdict.line).toContain('46.999');
    expect(verdict.line).not.toContain('47% is BELOW the floor 47%');
  });
});

describe('Scenario: behavior — --raise may raise the floor and may never lower it', () => {
  it('E: a measured value below the floor is REFUSED, and the message names both values', () => {
    const refusal = floor.raiseRefusal({
      measuredPct: trackedFloorPct - 0.1,
      linesPct: trackedFloorPct
    });
    expect(refusal, 'a below-floor measurement must not be writable').not.toBeNull();
    expect(refusal).toContain('REFUSING');
    expect(refusal).toContain(String(floor.raisedFloor(trackedFloorPct - 0.1)));
    expect(refusal).toContain(String(trackedFloorPct));
  });

  it('F: a measured value above the floor is writable, minus the stated margin', () => {
    const measured = trackedFloorPct + 5;
    expect(floor.raiseRefusal({ measuredPct: measured, linesPct: trackedFloorPct })).toBeNull();
    expect(floor.raisedFloor(measured)).toBeCloseTo(measured - floor.FLOOR_MARGIN_PP, 10);
    expect(measured - floor.raisedFloor(measured)).toBeGreaterThanOrEqual(0.2);
  });

  it('G: a rise SMALLER than the margin is refused rather than written as a fall', () => {
    // measured rose, but not by enough to clear the margin: writing `measured - margin`
    // would LOWER the floor, which is the thing monotonicity exists to prevent.
    const refusal = floor.raiseRefusal({
      measuredPct: trackedFloorPct + 0.1,
      linesPct: trackedFloorPct
    });
    expect(refusal).not.toBeNull();
  });
});

describe('Scenario: behavior — the population is pinned by SIZE, so a subset cannot read green', () => {
  it('W: a report accounting for fewer rows than the floor records is REFUSED', () => {
    const problem = floor.unaccountedProblem({
      rows: 1,
      floorRows: trackedRows,
      population: 'src/**'
    });
    expect(problem, 'a one-row report must not be a measurement of the population').not.toBeNull();
    expect(problem).toContain('SUBSET');
    expect(problem).toContain(String(trackedRows));
  });

  it('X: a report accounting for MORE rows is fine — the count is a floor, like the percentage', () => {
    const at = { rows: trackedRows, floorRows: trackedRows, population: 'src/**' };
    expect(floor.unaccountedProblem(at)).toBeNull();
    expect(floor.unaccountedProblem({ ...at, rows: trackedRows + 10 })).toBeNull();
  });

  it('Y: the tracked artifact records a row count, and the floor parser demands one', () => {
    expect(Number.isInteger(JSON.parse(trackedBytes).files)).toBe(true);
    const document = { ...JSON.parse(trackedBytes), files: undefined };
    expect(
      floor.floorProblems(document, { population: report.POPULATION_GLOB }).join(' ')
    ).toContain('files');
  });
});

describe('Scenario: behavior — a lowered floor is refused against HEAD', () => {
  it('Z: a working floor below HEAD is refused, and the message names both', () => {
    const refusal = floor.loweringRefusal({
      head: { linesPct: 47.0 },
      working: { linesPct: 5.0 },
      allowLower: false
    });
    expect(refusal).not.toBeNull();
    expect(refusal).toContain('REFUSING');
    expect(refusal).toContain('5');
    expect(refusal).toContain('47');
  });

  it('AA: equal and raised floors pass, and a missing HEAD is the seed, not a refusal', () => {
    const head = { linesPct: 47.0 };
    expect(
      floor.loweringRefusal({ head, working: { linesPct: 47.0 }, allowLower: false })
    ).toBeNull();
    expect(
      floor.loweringRefusal({ head, working: { linesPct: 48.0 }, allowLower: false })
    ).toBeNull();
    expect(
      floor.loweringRefusal({ head: null, working: { linesPct: 5.0 }, allowLower: false })
    ).toBeNull();
  });

  it('AB: --lower-floor makes the lowering an explicit, named act', () => {
    expect(
      floor.loweringRefusal({
        head: { linesPct: 47.0 },
        working: { linesPct: 5.0 },
        allowLower: true
      })
    ).toBeNull();
  });
});

describe('Scenario: behavior — the report reader is fail-closed', () => {
  const options = { root: REPO_ROOT };

  it('H: an empty or unreadable report is refused, never read as zero coverage', () => {
    for (const text of ['', '   ', '\n']) {
      expect(report.readSummary(text, options).problem, JSON.stringify(text)).not.toBeNull();
    }
  });

  it('I: an unparseable report is refused', () => {
    expect(report.readSummary('{ not json', options).problem).toContain('not parseable JSON');
  });

  it('J: no total, no numeric pct, or a pct outside [0, 100], is refused', () => {
    expect(report.readSummary('{"src/a.ts":{}}', options).problem).toContain('no `total` row');
    expect(report.readSummary('{"total":{}}', options).problem).toContain('no numeric');
    expect(report.readSummary('{"total":{"lines":{"pct":"high"}}}', options).problem).toContain(
      'no numeric'
    );
    // Asymmetric with `floorProblems` before this: an impossible percentage read HELD.
    for (const pct of [1000, 101, 1e9, -1]) {
      const problem = report.readSummary(fixtureReport(pct, srcKeys), options).problem;
      expect(problem, `pct ${pct} must be refused`).toContain('outside [0, 100]');
    }
    expect(report.readSummary(fixtureReport(100, srcKeys), options).problem).toBeNull();
    expect(report.readSummary(fixtureReport(0, srcKeys), options).problem).toBeNull();
  });

  it('K: a report listing NO file rows is refused — nothing measured is not a pass', () => {
    expect(report.readSummary('{"total":{"lines":{"pct":99}}}', options).problem).toContain(
      'no file rows'
    );
  });

  it('L: a row outside the population is refused, the row is NAMED, and the count is a NUMBER', () => {
    const distKey = `${REPO_ROOT}/dist/cli/index.js`;
    const result = report.readSummary(fixtureReport(99, [...srcKeys, distKey]), options);
    expect(result.problem, 'a dist row must not be measurable').toContain('OUTSIDE');
    expect(result.foreign).toEqual([distKey]);
    // This was an ARRAY here and a number elsewhere, so the population line printed
    // "src/a.ts file(s)" on exactly the refusal an operator reads.
    expect(typeof result.files).toBe('number');
    expect(result.files).toBe(3);
  });

  it('M: a clean report yields the total and the file count as data', () => {
    const result = report.readSummary(fixtureReport(61.5, srcKeys), options);
    expect(result.problem).toBeNull();
    expect(result.linesPct).toBe(61.5);
    expect(result.files).toBe(2);
    expect(result.foreign).toEqual([]);
  });

  it('N: the population check accepts a relative row and rejects a foreign absolute one', () => {
    expect(
      report.readSummary('{"total":{"lines":{"pct":50}},"src/a.ts":{"lines":{"pct":50}}}', options)
        .problem
    ).toBeNull();
    const foreign = report.readSummary(
      JSON.stringify({
        total: { lines: { pct: 50 } },
        [`${REPO_ROOT}/../elsewhere/src/a.ts`]: { lines: { pct: 50 } }
      }),
      options
    );
    expect(foreign.problem).not.toBeNull();
  });

  it('AC: JSON null is named as null, not as "object"', () => {
    expect(report.readSummary('null', options).problem).toContain('is null, not a JSON object');
    expect(report.readSummary('[]', options).problem).toContain('an array');
  });

  it('AG: a refusal still reports the row count the report actually had', () => {
    // Reporting 0 while rows are present would say "nothing was measured" about a report that did
    // measure something — the one sentence this reader may never print wrongly.
    expect(report.readSummary(fixtureReport(1000, srcKeys), options).files).toBe(2);
    expect(report.readSummary('{"total":{"lines":{"pct":50}},"src/a.ts":{}}', options).files).toBe(
      1
    );
  });
});

describe('Scenario: render — the measuring command and the artifact agree on one population', () => {
  it('O: the measuring command sets coverage.include, which is what puts untested files in', () => {
    // vitest 4 removed `coverage.all`; the property it gave — an untested file under `src/` is
    // inside the DENOMINATOR — is now provided by `coverage.include` being set at all
    // (@vitest/coverage-v8 provider.js: "Include untested files when all tests were run", guarded by
    // `options.include != null`). Asserting `coverage.all` would assert an option this runner
    // ignores, so this arm pins the option that actually carries the property.
    const include = report.MEASURE_ARGS.filter((arg) => arg.startsWith('--coverage.include='));
    expect(include).toEqual([`--coverage.include=${report.POPULATION_GLOB}`]);
    expect(report.MEASURE_ARGS.some((arg) => arg.includes('coverage.all'))).toBe(false);
  });

  it('P: the tracked artifact names the SAME population the command measures', () => {
    const document = JSON.parse(trackedBytes);
    expect(document.population).toBe(report.POPULATION_GLOB);
    expect(document.counter).toBe(floor.COUNTER);
    expect(floor.floorProblems(document, { population: report.POPULATION_GLOB })).toEqual([]);
  });

  it('Q: a floor naming another population is refused, so the two spellings cannot drift', () => {
    const document = { ...JSON.parse(trackedBytes), population: 'packages/**' };
    expect(
      floor.floorProblems(document, { population: report.POPULATION_GLOB }).join(' ')
    ).toContain('packages/**');
  });
});

describe('Scenario: integration and a11y — --raise refuses and writes nothing', () => {
  it(
    'V: --raise REFUSES a below-floor measurement and leaves the tracked artifact byte-identical',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      withReport(fullReport(trackedFloorPct - 1, population), (path) => {
        const run = ratchet(['--raise', '--report', path]);
        expect(run.code, run.out).toBe(1);
        expect(run.out).toContain('REFUSING');
        expect(run.out).toContain('BELOW the floor already on disk');
      });
      // The claim is that NOTHING was written. Byte-compare, so a write that happened to be
      // identical could not pass by luck either.
      expect(readFileSync(FLOOR_ABS, 'utf8')).toBe(trackedBytes);
    }
  );
});
