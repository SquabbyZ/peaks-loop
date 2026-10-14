// tests/unit/lint/eslint-ceiling-derivation.test.ts
//
// BACKLOG 9.4, FIRST HALF — IS THE SURVIVING NUMERIC ESLINT CEILING DERIVED, OR A SECOND BOUND?
//
// The ruling of 2026-10-13 asked for "a named exemption table ... in place of a numeric
// ceiling that can only absorb". `d3684dbc` landed the table and KEPT
// `ceilings.eslintFindings` / `ceilings.eslintErrors`: `repo` mode still prints them and
// still compares them. Whether that surviving number is DERIVED from the named rows or is
// a SECOND, independent bound is the whole question — a count ceiling wider than the rows
// beside it has room where an individual finding lands without any row moving, which is
// precisely the capacity the ruling removed.
//
// THE MEASUREMENT THIS FILE MAKES EXECUTABLE. Summed over the published artifact:
//
//   sum(files[*].eslint)       = 1722 = ceilings.eslintFindings    (slack 0)
//   sum(files[*].eslintErrors) =  572 = ceilings.eslintErrors      (slack 0)
//   Object.keys(files).length  = 1289 = invocation.linted          (every linted file has a row)
//
// Those three equalities are what make the surviving number a SUM of the table rather than
// a bound beside it. Nothing asserted them: `tests/unit/lint/findings-table.test.ts` states
// the same relation inside a FIXTURE, and `findings-table-row-guard.test.ts` guards the
// generator's per-row direction, but the published artifact was never read for the relation
// itself — so a regeneration that narrowed or widened one side of it would be silent.
//
// THE INPUT THE CHECK IS WRITTEN TO REJECT, and the two red arms are built from exactly it:
//   - a ceiling ABOVE the sum of its rows — slack, capacity no row has to account for;
//   - a `files` map carrying FEWER rows than the run linted — a ceiling measured over a
//     population wider than the table printed beside it.
// Both are constructed and both are asserted to refuse, so the arms fail for the reason the
// rule exists rather than passing because they never exercised the path.
//
// WHAT THIS FILE DOES NOT CLAIM. Zero slack is NOT what stops an individual finding: the
// per-file row fires first and reds by name whether or not the total has room (measured on
// the commit path: a tolerated file taken 1 → 2 findings prints "went from 1 to 2 lint
// finding(s) (+1)" and exits 1). What the equality below establishes is the narrower and
// still load-bearing thing: the count carries no independent information.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/lint/eslint-ceiling-derivation.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason: 'nothing is rendered; the observable is the returned failure text'
    }
  ]
);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const BASELINE_PATH = join(REPO_ROOT, '.peaks', 'lint', 'gate-baseline.json');

/** One per-file row, as the artifact writes it. `unknown` on purpose — see `readCount`. */
type Row = Readonly<Record<string, unknown>>;

/** The part of the artifact this rule reads. Everything else is none of its business. */
type Derivation = {
  readonly ceilings: Readonly<Record<string, unknown>>;
  readonly files: Readonly<Record<string, Row>>;
  readonly invocation: Readonly<Record<string, unknown>>;
};

/** What the artifact names for one quantity: its ceiling key, its row key, its noun. */
const QUANTITIES = [
  { ceiling: 'eslintFindings', row: 'eslint', noun: 'lint finding' },
  { ceiling: 'eslintErrors', row: 'eslintErrors', noun: 'lint error' }
] as const;

/**
 * A row's count, or `null` when it is not a non-negative integer. Fail closed: a value this
 * rule cannot read is NOT zero, because reading it as zero would make a missing row look
 * like a clean one — the direction that turns a breach into a pass.
 */
function readCount(source: Readonly<Record<string, unknown>>, key: string): number | null {
  const value = source[key];
  return Number.isInteger(value) && (value as number) >= 0 ? (value as number) : null;
}

/** How a rejected value is named, without ever rendering `undefined` as a number. */
function namedValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === undefined) return 'nothing';
  if (value === null) return 'null';
  return String(value);
}

/**
 * THE RULE. For each quantity: the ceiling must EQUAL the sum of the named rows, and the
 * `files` map must carry one row per file the run linted.
 *
 * A ceiling ABOVE the sum is slack — the "second, independent bound that can still absorb"
 * the ruling names, arriving as a number nobody has to walk a row to spend. A ceiling BELOW
 * the sum is the artifact disagreeing with itself: the rows it prints and the total it
 * prints beside them describe different trees.
 */
function judgeCeilingDerivation(artifact: Derivation): { failures: string[]; totals: number[] } {
  const failures: string[] = [];
  const totals: number[] = [];
  for (const quantity of QUANTITIES) {
    let sum = 0;
    for (const [file, row] of Object.entries(artifact.files)) {
      const count = readCount(row ?? {}, quantity.row);
      if (count === null) {
        // A row the artifact writes for a linted file must carry the number; a missing one
        // would vanish from the sum silently and make the ceiling look derived when it is not.
        failures.push(
          `${file}: the row carries ${namedValue(row?.[quantity.row])} for '${quantity.row}', ` +
            'so this file contributes nothing to the sum the ceiling is compared against.'
        );
        continue;
      }
      sum += count;
    }
    totals.push(sum);
    const ceiling = readCount(artifact.ceilings, quantity.ceiling);
    if (ceiling === null) {
      failures.push(
        `the artifact names ${namedValue(artifact.ceilings[quantity.ceiling])} at ` +
          `'${quantity.ceiling}', which is not a non-negative integer, so this run cannot ` +
          'tell what it bounds.'
      );
      continue;
    }
    if (ceiling > sum) {
      failures.push(
        `SLACK: '${quantity.ceiling}' is ${ceiling} and its ${quantity.noun}s sum to ${sum} ` +
          `over the ${Object.keys(artifact.files).length} named rows — ${ceiling - sum} of ` +
          'capacity no row has to account for. A count ceiling wider than the table it sits ' +
          'beside is a second, independent bound, which is the shape the named table replaced.'
      );
    } else if (ceiling < sum) {
      failures.push(
        `the artifact disagrees with itself: '${quantity.ceiling}' is ${ceiling} and its ` +
          `${quantity.noun}s sum to ${sum} — the total and the rows below it describe ` +
          'different trees.'
      );
    }
  }
  const rows = Object.keys(artifact.files).length;
  const linted = readCount(artifact.invocation, 'linted');
  if (linted === null) {
    failures.push(
      `invocation.linted is ${namedValue(artifact.invocation['linted'])}, which is not a ` +
        'non-negative integer, so the population the rows should cover is unknown.'
    );
  } else if (linted > rows) {
    failures.push(
      `the run linted ${linted} file(s) and the artifact carries ${rows} row(s): ` +
        `${linted - rows} linted file(s) sit outside the table the ceiling is the sum of, ` +
        'so the ceiling covers a population wider than the rows printed beside it.'
    );
  } else if (rows > linted) {
    failures.push(
      `the artifact carries ${rows} row(s) for ${linted} linted file(s): ` +
        `${rows - linted} row(s) describe files this run did not measure.`
    );
  }
  return { failures, totals };
}

/** The published artifact, read once. */
function published(): Derivation {
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Derivation;
}

/** A copy of the published artifact with one ceiling lifted, for the slack arm. */
function withLiftedCeiling(by: number): Derivation {
  const artifact = published();
  const lifted = readCount(artifact.ceilings, QUANTITIES[0].ceiling) ?? 0;
  return {
    ...artifact,
    ceilings: { ...artifact.ceilings, [QUANTITIES[0].ceiling]: lifted + by }
  };
}

/**
 * A copy of the published artifact with one row dropped, for the population arm.
 *
 * The row is chosen as the one carrying the MOST findings, not the first one: dropping a row
 * that sits at zero leaves the sum where it was and this arm would then be asserting slack
 * that its own input did not create.
 */
function withDroppedRow(): Derivation {
  const artifact = published();
  const rows = { ...artifact.files };
  const heaviest = Object.entries(rows).reduce((best, entry) =>
    (readCount(entry[1], 'eslint') ?? 0) > (readCount(best[1], 'eslint') ?? 0) ? entry : best
  );
  delete rows[heaviest[0]];
  return { ...artifact, files: rows };
}

describe('behavior — the rule over hand-built inputs', () => {
  it('when the ceiling is above the sum of its rows, should refuse naming the slack', () => {
    // given: 4 findings in the rows and a ceiling of 5 — one of capacity no row accounts for
    const judged = judgeCeilingDerivation({
      ceilings: { eslintFindings: 5, eslintErrors: 0 },
      files: { 'src/a.ts': { eslint: 4, eslintErrors: 0 } },
      invocation: { linted: 1 }
    });
    // when: the rule reads it
    // then: it refuses, names the slack's SIZE and its SOURCE, and says which shape it is
    expect(judged.failures).toHaveLength(1);
    expect(judged.failures[0]).toContain('SLACK');
    expect(judged.failures[0]).toContain("'eslintFindings' is 5");
    expect(judged.failures[0]).toContain('1 of capacity');
    expect(judged.failures[0]).toContain('a second, independent bound');
  });

  it('when the ceiling EQUALS the sum, should pass', () => {
    // given: the same rows with the ceiling pointed at their sum — the control for the arm
    //        above, so the refusal is known to come from the slack and not from the shape
    const judged = judgeCeilingDerivation({
      ceilings: { eslintFindings: 4, eslintErrors: 0 },
      files: { 'src/a.ts': { eslint: 4, eslintErrors: 0 } },
      invocation: { linted: 1 }
    });
    // when/then
    expect(judged.failures).toEqual([]);
  });

  it('when the ceiling is BELOW the sum, should refuse it as a disagreement', () => {
    // given: the other direction — a total narrower than the rows it is printed beside
    const judged = judgeCeilingDerivation({
      ceilings: { eslintFindings: 3, eslintErrors: 0 },
      files: { 'src/a.ts': { eslint: 4, eslintErrors: 0 } },
      invocation: { linted: 1 }
    });
    // when/then
    expect(judged.failures).toHaveLength(1);
    expect(judged.failures[0]).toContain('disagrees with itself');
  });

  it('when a row carries no integer, should refuse rather than sum it as zero', () => {
    // given: a row with no readable count — the value a `?? 0` would have hidden
    const judged = judgeCeilingDerivation({
      ceilings: { eslintFindings: 0, eslintErrors: 0 },
      files: { 'src/a.ts': { eslint: null, eslintErrors: 0 } },
      invocation: { linted: 1 }
    });
    // when/then: the row is named, and the sum is asserted to have left it out rather than
    //            to have counted it as a clean file
    expect(judged.failures).toHaveLength(1);
    expect(judged.failures[0]).toContain('src/a.ts');
    expect(judged.failures[0]).toContain('null');
    expect(judged.totals[0]).toBe(0);
  });

  it('when the file map is narrower than the linted population, should refuse', () => {
    // given: 2 files linted, 1 row — the ceiling covers a population wider than the table
    const judged = judgeCeilingDerivation({
      ceilings: { eslintFindings: 0, eslintErrors: 0 },
      files: { 'src/a.ts': { eslint: 0, eslintErrors: 0 } },
      invocation: { linted: 2 }
    });
    // when/then
    expect(judged.failures).toHaveLength(1);
    expect(judged.failures[0]).toContain('linted 2 file(s) and the artifact carries 1 row(s)');
    expect(judged.failures[0]).toContain('outside the table');
  });
});

describe('integration — the published artifact', () => {
  it('when read, should show ceiling == sum of rows for both eslint quantities', () => {
    // given: `.peaks/lint/gate-baseline.json`, the artifact the gate enforces
    const artifact = published();
    const { failures, totals } = judgeCeilingDerivation(artifact);
    // when/then: slack is ZERO — measured 2026-10-14, 1722 findings and 572 errors over
    //            1289 rows — so the surviving total is the table's sum and not a second bound
    expect(failures).toEqual([]);
    expect(totals).toEqual([
      readCount(artifact.ceilings, 'eslintFindings'),
      readCount(artifact.ceilings, 'eslintErrors')
    ]);
  });

  it('when read, should carry one row per linted file', () => {
    // given/when: the same artifact
    const artifact = published();
    // then: the population the ceiling sums over is exactly the population the rows describe
    expect(Object.keys(artifact.files).length).toBe(readCount(artifact.invocation, 'linted'));
  });

  it('when the published artifact is lifted by one finding, should refuse (red direction)', () => {
    // given: the REAL artifact with its `eslintFindings` ceiling raised by exactly 1 — the
    //        input this check exists to reject, built on the artifact rather than on a shape
    //        imagined for it. A raised ceiling is what the monotonicity guard refuses at
    //        generation; this arm is about what the RELATION would say if one ever landed.
    const judged = judgeCeilingDerivation(withLiftedCeiling(1));
    // when/then
    expect(judged.failures).toHaveLength(1);
    expect(judged.failures[0]).toContain('SLACK');
    expect(judged.failures[0]).toContain('1 of capacity');
  });

  it('when a published row is dropped, should refuse (red direction)', () => {
    // given: the REAL artifact with one of its 1289 rows removed — the state a regeneration
    //        leaves when the row set and the population part company
    const judged = judgeCeilingDerivation(withDroppedRow());
    // when/then: the dropped row's count leaves the sum, so the ceiling now names capacity
    //            no row accounts for, AND the population the run states is wider than the
    //            table — both faces of one divergence, each named
    // The counts are read off the artifact rather than typed, so the arm does not turn red
    // when the scope legitimately grows — only when the divergence does.
    const linted = readCount(published().invocation, 'linted') ?? -1;
    expect(judged.failures.some((f) => f.includes('SLACK'))).toBe(true);
    expect(
      judged.failures.some((f) =>
        f.includes(
          `linted ${String(linted)} file(s) and the artifact carries ${String(linted - 1)}`
        )
      )
    ).toBe(true);
  });
});

describe('a11y — what a reader of a refusal is told', () => {
  it('when the ceiling has slack, should name the quantity, both numbers and the amount', () => {
    // given: a ceiling 3 above its rows
    const judged = judgeCeilingDerivation({
      ceilings: { eslintFindings: 7, eslintErrors: 0 },
      files: { 'src/a.ts': { eslint: 4, eslintErrors: 0 } },
      invocation: { linted: 1 }
    });
    // when/then: a reader can act on it without opening the artifact
    expect(judged.failures[0]).toContain('eslintFindings');
    expect(judged.failures[0]).toContain('7');
    expect(judged.failures[0]).toContain('4');
    expect(judged.failures[0]).toContain('3 of capacity');
  });
});
