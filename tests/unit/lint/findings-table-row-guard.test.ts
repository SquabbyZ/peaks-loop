// tests/unit/lint/findings-table-row-guard.test.ts
//
// Rid `rid-count-ceiling-exemption-table`, F-1 of the review — THE GENERATOR'S HALF OF
// THE NAMED TABLE.
//
// THE DEFECT, TWO STEPS OF ONE SEQUENCE. Step one is the GATE, and it already works: a
// total-neutral reshuffle (A 1 → 0, B 0 → 1) leaves every ceiling exactly where it was,
// and `repo` mode refuses it ANYWAY — by name, `src/tidy.ts went from 0 to 1 lint
// finding(s) (+1)` — because `.husky/gate/findings-table.mjs` compares the per-file rows,
// not the sum. Arm G of `findings-table.test.ts` pins that step.
//
// Step two is the WRITER, and it was open: the generator's guard compared `CEILING_KEYS`
// only, the per-file rows are not ceilings, and nothing under `.husky/` read a previous
// per-file map at all — the anchor parsed `files` for its KEYS and threw the values away.
// So `node .husky/peaks-gate-baseline.mjs` — the command the gate's own descent sentence
// recommends — rewrote A = 0 / B = 1, and the next `repo` run compared B(1) with its own
// new row(1) and went GREEN. The gate refused the reshuffle and the remedy laundered it.
// `.husky/monotonic/rows.mjs` closes that: a row may only go DOWN.
//
// THE ARMS RUN THE REAL GENERATOR TWICE IN ONE FIXTURE. The seed writes the artifact and
// the fixture then commits it, because the guard's anchor is `git show HEAD:…` — a
// fixture with no artifact at HEAD cannot witness a write refusal at all. Everything
// stubbed here (eslint, tsc, the detectors) is stubbed exactly as
// `_file-size-hooks-fixture.ts` documents, and NOTHING IS WRITTEN INTO THIS REPOSITORY
// (§2.31): the instance is a `mkdtempSync` tree with its own `git init`, removed by
// `afterAll`.
//
// Dimensions:
//   - behavior:    the comparison itself, on scratch row maps
//   - integration: the real generator process, a real anchor, a real refusal
//   - render:      the refusal sentence, as the operator-visible evidence it is
//   - a11y:        omitted — the only surface is that sentence, asserted in the arms

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import { REPO_ROOT } from '../standards/_file-size-cap-scan.js';
import { createFixture, type Fixture } from './_file-size-hooks-fixture.js';

declareDimensions(
  'tests/unit/lint/findings-table-row-guard.test.ts',
  ['behavior', 'integration', 'render'],
  [
    {
      dim: 'a11y',
      reason: 'the refusal text is the whole operator-facing surface, and it is asserted verbatim'
    }
  ]
);

/** The generator guard's surface, spelled here: `.husky/` is outside this tsconfig. */
type RowMap = Record<string, { eslint?: unknown; eslintErrors?: unknown }>;
type RowGuardModule = {
  compareRowCounts(
    previous: RowMap | null,
    next: RowMap | null
  ): {
    raised: Array<{ file: string; key: string; previous: number; next: number }>;
    lowered: Array<{ file: string; key: string; previous: number; next: number }>;
    malformed: Array<{ file: string; key: string }>;
    compared: number;
  };
  describeRowFailure(result: { raised?: unknown[]; malformed?: unknown[] }): string | null;
  describeRowNote(lowered: Array<{ file: string }>): string | null;
};

let guard: RowGuardModule;

/**
 * A row map in the shape `buildFileRecords` writes: BOTH quantities, always. The guard
 * compares `eslint` and `eslintErrors` and refuses a row that carries no integer at
 * either, so a scratch map with one key would be refusing a shape the real artifact
 * cannot have — the arm would then be about this helper, not about the guard.
 */
function rowMap(findings: Record<string, number>, errors: Record<string, number> = {}): RowMap {
  return Object.fromEntries(
    Object.entries(findings).map(([file, eslint]) => [
      file,
      { eslint, eslintErrors: errors[file] ?? 0 }
    ])
  );
}

beforeAll(async () => {
  guard = (await import(
    pathToFileURL(join(REPO_ROOT, '.husky', 'monotonic', 'rows.mjs')).href
  )) as RowGuardModule;
});

describe('Scenario: behavior — a row may only go DOWN', () => {
  it('A: when the reshuffle is total-neutral, should name the row that rose', () => {
    // given: A 1 → 0 and B 0 → 1 — the measured case, whose SUM is unchanged at 1.
    const before = rowMap({ 'src/a.ts': 1, 'src/b.ts': 0 });
    const after = rowMap({ 'src/a.ts': 0, 'src/b.ts': 1 });
    // when: the guard compares them
    const comparison = guard.compareRowCounts(before, after);
    // then: both rows were compared, the descent is recorded as one, and the RISE refuses
    //       naming the file — a comparison that only counted totals would see nothing
    expect(comparison.compared, 'both quantities of both rows').toBe(4);
    expect(comparison.lowered.map((row) => row.file)).toEqual(['src/a.ts']);
    expect(comparison.raised.map((row) => row.file)).toEqual(['src/b.ts']);
    expect(comparison.raised[0]?.previous).toBe(0);
    expect(comparison.raised[0]?.next).toBe(1);
    const failure = guard.describeRowFailure(comparison);
    expect(failure).toContain('src/b.ts');
    expect(failure).toContain('0 → 1');
  });

  it('B: when every row descends, should refuse nothing and report the descent', () => {
    // given: two rows strictly lower than HEAD's.
    const before = rowMap({ 'src/a.ts': 3 }, { 'src/a.ts': 1 });
    const after = rowMap({ 'src/a.ts': 1 }, { 'src/a.ts': 0 });
    // when: the guard compares them
    const comparison = guard.compareRowCounts(before, after);
    // then: no refusal — a ratchet that refused its own descent would demand a clean tree
    //       — and the descent is a sentence rather than a silence
    expect(guard.describeRowFailure(comparison)).toBeNull();
    expect(comparison.lowered).toHaveLength(2);
    expect(guard.describeRowNote(comparison.lowered)).toContain('src/a.ts');
  });

  it('C: when a row is absent on either side, should not compare it at all', () => {
    // given: one path joining the table and one leaving it — the two shapes that are NOT
    //        rises, and that a comparison reading `undefined` as zero would misjudge.
    const before = rowMap({ 'src/left.ts': 4 });
    const after = rowMap({ 'src/joined.ts': 2, 'src/left.ts': 4 }); // when: the guard compares them
    const comparison = guard.compareRowCounts(before, after);
    // then: only the row present on both sides was compared, and nothing refuses: a new
    //       path's debts are the ceiling's business, a missing one's the rescope trip's
    expect(comparison.compared, 'the one row on both sides, both quantities').toBe(2);
    expect(comparison.raised).toEqual([]);
    expect(guard.describeRowFailure(comparison)).toBeNull();
  });

  it('D: when a row carries no integer, should refuse it rather than skip it', () => {
    // given: HEAD's row intact and this run's row stripped of its number — the shape a
    //        hand edit or a failing classifier leaves behind.
    const before = rowMap({ 'src/a.ts': 2 });
    const after = { 'src/a.ts': { eslintErrors: 0 } }; // the number is gone
    // when: the guard compares them
    const comparison = guard.compareRowCounts(before, after);
    // then: the unreadable row refuses; skipping it would turn "cannot compare" into
    //       "nothing rose", which is the reading that makes a breach a pass
    expect(comparison.malformed).toEqual([{ file: 'src/a.ts', key: 'eslint' }]);
    expect(guard.describeRowFailure(comparison)).toContain('UNREADABLE');
  });
});

// ---------------------------------------------------------------------------
// The real generator, over a table the real seed wrote and the fixture committed
// ---------------------------------------------------------------------------
const PLANTED_REL = 'src/dirty-one.ts';
const TIDY_REL = 'src/tidy.ts';
const ESLINT_BIN_REL = join('node_modules', 'eslint', 'bin', 'eslint.js');

/** ONE warning finding on the file whose basename starts with `token`; nothing else. */
function eslintStubFor(token: string): string {
  return [
    "const path = require('node:path');",
    'const files = process.argv.slice(2).filter((a) => !a.startsWith("-"));',
    'const reports = files.map((f) => ({',
    '  filePath: path.resolve(f),',
    `  messages: path.basename(f).startsWith(${JSON.stringify(token)})`,
    "    ? [{ ruleId: 'no-console', severity: 1, message: 'Unexpected console statement.', line: 1, column: 1 }]",
    '    : [],',
    '}));',
    'process.stdout.write(JSON.stringify(reports));',
    ''
  ].join('\n');
}

let fx: Fixture | null = null;
function fixture(): Fixture {
  if (fx === null) {
    fx = createFixture('findings-row-guard');
    fx.write(PLANTED_REL, 'export const dirtyOne = 1;\n');
    fx.write(ESLINT_BIN_REL, eslintStubFor('dirty-one'));
    fx.commitAll('fixture: one planted file whose findings the seed will name');
  }
  return fx;
}

/** The artifact's bytes, hashed — the guard's invariant is that a refusal writes nothing. */
function artifactSha(): string {
  return createHash('sha256').update(readFileSync(fixture().artifactPath)).digest('hex');
}

beforeAll(() => {
  const seed = fixture().runGenerator(['--seed']);
  expect(seed.code, seed.out).toBe(0);
  // HEAD must CARRY the artifact, or the guard's anchor is absent and every write is the
  // documented `--seed` path — a fixture that could not witness a refusal at all.
  fixture().commitAll('fixture: HEAD now carries the seeded artifact the guard anchors on');
});

afterAll(() => {
  fx?.cleanup();
});

describe('Scenario: integration — the generator refuses what the gate refuses', () => {
  it(
    'E: when every row is unchanged, should write — the guard is not a blanket refusal',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: the same eslint as the seed, so every row equals HEAD's.
      // when: the generator runs against that anchor
      const run = fixture().runGenerator();
      // then: it writes — a guard that refused an identical re-run would block every
      //       regeneration, which is the whole-repo demand this ratchet refuses
      expect(run.code, run.out).toBe(0);
      expect(run.out + run.out).toContain('wrote .peaks/lint/gate-baseline.json');
    }
  );

  it(
    'F: when the finding MOVES between two rows, should refuse and leave the artifact untouched',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: the finding moved off the named file and onto `src/tidy.ts`, which HEAD's
      //        table names at ZERO — a total-neutral reshuffle, and the exact write the
      //        gate's own descent sentence used to recommend.
      const before = artifactSha();
      writeFileSync(join(fixture().root, ESLINT_BIN_REL), eslintStubFor('tidy'), 'utf8');
      // when: the generator runs against the same anchor
      const run = fixture().runGenerator();
      // then: it REFUSES, naming the row that rose, and writes NOTHING — the bytes are
      //       what a refusal is for, and a laundered table is a green gate about debt it
      //       no longer names
      expect(run.code, run.out).toBe(1);
      const text = `${run.out}${run.out}`;
      expect(text).toContain('PER-FILE ROWS RAISED');
      expect(text).toContain(TIDY_REL);
      expect(text).toContain('0 → 1');
      expect(text).toContain('REFUSING to write');
      expect(artifactSha(), 'a refused run must not rewrite the artifact').toBe(before);
      // and: the SHRINK it also measured is still reported, so the refusal is not read as
      //      "nothing moved" — the descent is the half that keeps the table pointable
      expect(text).toContain('descended');
    }
  );
});
