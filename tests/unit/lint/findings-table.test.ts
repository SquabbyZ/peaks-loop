// tests/unit/lint/findings-table.test.ts
//
// Rid `rid-count-ceiling-exemption-table` — the two eslint rows as a NAMED TABLE.
//
// THE DEFECT, REPLAYED. `repo` mode asserted `eslintFindings`, which is a COUNT, and a
// bound on a count cannot force action on any individual finding: clean one file, let
// another grow by the same amount, and the total — and therefore the run — is unchanged.
// Measured: the rule `no-require-imports` (severity ERROR) reported all 16 sites of the
// ESM `require()` family inside a total of 1758 the whole time, and nothing could read
// that. Arm A replays the flat reshuffle against BOTH forms on one scratch table: the
// count form is green, the table form refuses and NAMES the file whose row grew.
//
// WHY THE OLD FORM IS KEPT IN THE FILE. It is not a straw man — arm 0 shows it refusing
// when a total really rises, which is the case it was built for. It is here as the
// negative arm of the new assertion, the way `lint-file-list-parity.test.ts` keeps
// `PRE_FIX_LINT_SCRIPT` and `eslint-rules-config-coverage.test.ts` replays the pre-fix
// ignore patterns: an arm that only ever sees the new rule cannot show that the OLD one
// was the leak.
//
// THE GATE ARMS RUN THE REAL PROCESS. `.husky/gate/findings-table.mjs` is a module, and
// a module nothing calls covers nothing, so arms 4-5 run `node .husky/peaks-gate.mjs repo`
// in a scratch repository whose table was seeded by the REAL generator, and swap that
// fixture's eslint between the two runs, so the total is IDENTICAL and only the NAMES
// move. Nothing is written into this repository (§2.31): the fixture is a `mkdtempSync`
// tree with its own `git init`.
//
// Dimensions:
//   - behavior:    the comparison — containment plus per-row no-growth — on scratch data
//   - integration: the real gate process in a fixture repository, real generator seed
//   - render:      the sentences the two rows print, as the evidence a red run carries
//   - a11y:        omitted — no operator-facing surface beyond those sentences, asserted
//                  in the render arms

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import { createFixture, type Fixture } from './_file-size-hooks-fixture.js';
import { runRepoMode } from './_silent-warning-scope-fixture.js';

declareDimensions(
  'tests/unit/lint/findings-table.test.ts',
  ['behavior', 'integration', 'render'],
  [
    {
      dim: 'a11y',
      reason:
        'the only operator-facing surface is the two sentences the render arms assert verbatim'
    }
  ]
);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MODULE_REL = join('.husky', 'gate', 'findings-table.mjs');

/**
 * The module's surface, spelled here rather than imported: `.husky/` sits outside this
 * tsconfig's `include`, so a static import of it is `TS7016` — the same reason
 * `format-check-ratchet.test.ts` and `lint-file-list-parity.test.ts` load `.husky/*.mjs`
 * by URL with a hand-written shape.
 */
type Row = { eslint?: number; eslintErrors?: number };
type TableResult = {
  failures: string[];
  totals: { findings: number; errors: number };
  tolerated: number;
  namedAtZero: number;
  /**
   * Named non-zero rows for paths this run did NOT measure. It is the slack the rename
   * launder lives in (arm J), and it was absent from this hand-written shape until that
   * arm needed it — the module has returned it since the table landed.
   */
  unmeasured: number;
  shrinking: string[];
};
type Judged = { failures: string[]; improved: number };
type FindingsTableModule = {
  judgeLintRow(input: {
    file: string;
    measured: Record<string, unknown>;
    allowed?: Row | null;
    compareErrors?: boolean;
  }): Judged;
  judgeFindingsTable(input: {
    measured: Map<string, Record<string, unknown>>;
    table: Record<string, Row | undefined>;
  }): TableResult;
  findingsTableLines(result: TableResult): string[];
};

let mod: FindingsTableModule;

// ---------------------------------------------------------------------------
// arm A/B/C's scratch table: three rows, two of them non-zero, one at zero.
// ---------------------------------------------------------------------------
/** The table the arms judge against — the SHAPE the census writes, hand-built. */
const TABLE = Object.freeze({
  'src/a.ts': { eslint: 1, eslintErrors: 0 },
  'src/b.ts': { eslint: 0, eslintErrors: 0 },
  'src/c.ts': { eslint: 2, eslintErrors: 1 }
});
const CEILING_FINDINGS = 3; // = 1 + 0 + 2, the sum of the rows: never typed downstream
const CEILING_ERRORS = 1;

/** A runEslint verdict, as `runEslint` builds it, from a findings count. */
function verdict(findings: number, errors = 0): Record<string, unknown> {
  return findings === 0
    ? { findings: 0, errors, phantomFindings: 0, coverageGap: false, syntaxError: false }
    : {
        findings,
        errors,
        phantomFindings: 0,
        coverageGap: false,
        syntaxError: false,
        firstFinding: {
          ruleId: 'no-console',
          severity: errors > 0 ? 2 : 1,
          message: 'Unexpected console statement.',
          line: 1,
          column: 1
        }
      };
}

function tableOf(measured: Record<string, Record<string, unknown>>): TableResult {
  return mod.judgeFindingsTable({ measured: new Map(Object.entries(measured)), table: TABLE });
}

/**
 * THE PRE-CHANGE ASSERTION, replayed verbatim in its own terms: `repo` mode summed the
 * findings and compared the sum with the ceiling. Kept as a function rather than
 * deleted, because arm A's claim is about what this form CANNOT see, and that claim is
 * only observable if the form still exists to be run.
 */
function countForm(totals: { findings: number; errors: number }): string[] {
  const failures: string[] = [];
  if (totals.findings > CEILING_FINDINGS) failures.push('eslint findings rose');
  if (totals.errors > CEILING_ERRORS) failures.push('eslint errors rose');
  return failures;
}

describe('Scenario: behavior — the count form and the table form, on one scratch table', () => {
  it('CONTROL: when a TOTAL rises, the count form should refuse — it is not a straw man', () => {
    // given: the scratch table's rows, with one file over its row and the total over
    //        the ceiling (the case the count form was built for).
    const measured = { 'src/a.ts': verdict(2), 'src/b.ts': verdict(0), 'src/c.ts': verdict(2) };
    // when: both forms judge it
    const counted = countForm(tableOf(measured).totals);
    // then: both refuse — the new form does not buy its coverage by losing the old one's
    expect(counted).not.toEqual([]);
    expect(tableOf(measured).failures.length).toBeGreaterThan(0);
  });

  it('A: when one file is cleaned and a NAMED file gains the same count, should be green on the count and red by name on the table', () => {
    // given: `a.ts` (named at 1) drops to 0 and `b.ts` (named at ZERO) rises to 1, so the
    //        total is 3 either way — the flat reshuffle the count cannot see.
    const measured = { 'src/a.ts': verdict(0), 'src/b.ts': verdict(1), 'src/c.ts': verdict(2) };
    const judged = tableOf(measured);
    // when: the count form judges the total, and the table form judges the rows
    const counted = countForm(judged.totals);
    // then: the total is untouched and the count says nothing, while the table names the
    //       file whose row grew — with both numbers
    expect(judged.totals.findings).toBe(CEILING_FINDINGS);
    expect(counted).toEqual([]);
    expect(judged.failures).toHaveLength(1);
    expect(judged.failures[0]).toContain('src/b.ts');
    expect(judged.failures[0]).toContain('went from 0 to 1');
  });

  it('B: when a file the table does not name holds findings, should refuse naming that path', () => {
    // given: `src/new.ts` — a path the table has no row for — takes over the one finding
    //        `a.ts` gave up, so the total is again unchanged.
    const measured = { 'src/new.ts': verdict(1), 'src/c.ts': verdict(2) };
    const judged = tableOf(measured);
    // when: the table form judges it
    // then: the total is within the ceiling and the failure is BY NAME, not by number
    expect(judged.totals.findings).toBe(CEILING_FINDINGS);
    expect(countForm(judged.totals)).toEqual([]);
    expect(judged.failures).toHaveLength(1);
    expect(judged.failures[0]).toContain('NEW file src/new.ts');
    expect(judged.failures[0]).toContain('no-console at 1:1');
  });

  it('C: when a NAMED file carries an extra ERROR while its finding count holds, should refuse by name', () => {
    // given: `c.ts` is named at 1 error; this run measured 2 errors and 2 findings — the
    //        findings row is therefore silent, and only the errors row can see it.
    const allowed = { eslint: 2, eslintErrors: 1 };
    // when: the row is judged with errors compared (what `repo` mode does)
    const judged = mod.judgeLintRow({
      file: 'src/c.ts',
      measured: verdict(2, 2),
      allowed,
      compareErrors: true
    });
    // then: the errors row refuses by name, and the commit path — findings only — does not
    expect(judged.failures).toHaveLength(1);
    expect(judged.failures[0]).toContain('src/c.ts');
    expect(judged.failures[0]).toContain('lint error(s)');
    expect(
      mod.judgeLintRow({ file: 'src/c.ts', measured: verdict(2, 2), allowed }).failures
    ).toEqual([]);
  });

  it('D: when a named file comes in BELOW its row, should be green and report the descent', () => {
    // given: every row's findings cleared to zero
    const measured = { 'src/a.ts': verdict(0), 'src/b.ts': verdict(0), 'src/c.ts': verdict(0) };
    // when: the table judges the run
    const judged = tableOf(measured);
    const lines = mod.findingsTableLines(judged);
    // then: no failure, the totals descend, and the descent is named as the reason to
    //       re-point the table — a ratchet that cannot report its own shrinking cannot
    //       be kept pointed downwards
    expect(judged.failures).toEqual([]);
    expect(judged.totals.findings).toBe(0);
    expect(judged.shrinking.sort()).toEqual(['src/a.ts', 'src/c.ts']);
    expect(lines.join('\n')).toContain('came in BELOW their row');
    expect(lines.join('\n')).toContain('node .husky/peaks-gate-baseline.mjs');
  });

  it('E: when a row exists but names no integer, should refuse rather than read it as zero', () => {
    // given: a hand-built table whose row for `a.ts` lost its `eslint` number — the shape
    //        a hand edit leaves behind.
    const measured = { 'src/a.ts': verdict(1) };
    // when: the row is judged
    const judged = mod.judgeFindingsTable({
      measured: new Map(Object.entries(measured)),
      table: { 'src/a.ts': { eslintErrors: 0 } }
    });
    // then: it refuses — "no number to compare" must never be read as "nothing named",
    //       which is the reading that turns a breach into a pass
    expect(judged.failures).toHaveLength(1);
    expect(judged.failures[0]).toContain("names no integer at 'eslint'");
  });

  it('E2: when the ROW is null rather than absent, should refuse readably instead of throwing', () => {
    // given: `allowed` is `null` — the third malformed shape a hand edit leaves, and the
    //        one the module used to answer with a TypeError (F-3 of the review).
    // when: the row is judged — this LINE returning at all is the "no throw" half of the
    //       claim, so an arm that crashes fails here rather than passing on a stack
    const judged = mod.judgeLintRow({ file: 'src/a.ts', measured: verdict(1), allowed: null });
    // then: the readable refusal, not a crash — fail-closed by crashing is not the
    //       "FAIL CLOSED ON A MALFORMED ROW" this module's contract promises
    expect(judged.failures).toHaveLength(1);
    expect(judged.failures[0]).toContain("names no integer at 'eslint'");
  });

  it('F: when the MEASUREMENT is not an integer, should refuse it and keep it out of the totals', () => {
    // given: a verdict whose finding count is a string, then one whose count is null —
    //        QA's F-5. Neither is reachable from `eslint.mjs` today, which is why the
    //        coercion was one edit from being reachable with nothing to say so.
    const allowed = { eslint: 5, eslintErrors: 0 };
    // when: each is judged, and the table pass totals them
    const asString = mod.judgeLintRow({
      file: 'src/a.ts',
      measured: { findings: '3', errors: 0 },
      allowed
    });
    const asNull = mod.judgeFindingsTable({
      measured: new Map([['src/a.ts', { findings: null, errors: 0 }]]),
      table: { 'src/a.ts': allowed }
    });
    // then: an unreadable measurement is refused by name, and the totals stay NUMBERS —
    //       `"0" + "3"` and `NaN > ceiling` are both false-green rows the ceiling reads
    expect(asString.failures).toHaveLength(1);
    expect(asString.failures[0]).toContain("'findings'");
    expect(asString.failures[0]).toContain('"3"');
    expect(asNull.failures).toHaveLength(1);
    expect(asNull.totals.findings).toBe(0);
    expect(Number.isNaN(asNull.totals.findings)).toBe(false);
  });

  it('G: when a named path is spelled differently, should refuse it as a NEW path', () => {
    // given: `./src/a.ts` measured against a table that names `src/a.ts` — F-6 of the
    //        review, the exact-string lookup. Normalising is deliberately NOT done: both
    //        callers take their paths from git, and a normaliser here would be a second
    //        spelling of "which file is this" that no measurement observes.
    // when: the table pass looks the path up
    const judged = mod.judgeFindingsTable({
      measured: new Map([['./src/a.ts', verdict(1)]]),
      table: { 'src/a.ts': { eslint: 9, eslintErrors: 0 } }
    });
    // then: it refuses — the SAFE direction: a variant spelling is judged as an unnamed
    //       path, so it can never be tolerated by the row it merely resembles
    expect(judged.failures).toHaveLength(1);
    expect(judged.failures[0]).toContain('NEW file ./src/a.ts');
  });

  it('LIMITS (stated in the header, pinned here): when findings swap inside a file, or move onto a slack name, should both be green', () => {
    // given: the two shapes this table is honestly blind to, each measured once.
    const flat = mod.judgeLintRow({
      file: 'src/a.ts',
      measured: verdict(5),
      allowed: { eslint: 5, eslintErrors: 0 }
    });
    const moved = mod.judgeLintRow({
      file: 'src/moved-here.ts',
      measured: verdict(3),
      allowed: { eslint: 5, eslintErrors: 0 }
    });
    // when: both are judged
    // then: neither refuses — a finding swapped inside one file is not an identity, and a
    //       name is not one either. Pinned so the limits cannot be quietly dropped from
    //       the header, and so a future slice that closes one of them sees this go red
    expect(flat.failures).toEqual([]);
    expect(moved.failures).toEqual([]);
  });

  it('J: when a file RENAMES onto a row whose own file is gone, should launder it — backlog 9.4 AC-5', () => {
    // given: `src/gone.ts` held 9 findings and was DELETED. Its row is not removed — the
    //        artifact keeps a row per named path, and a run reports such rows as "counted
    //        and not judged" — so the NAME is worth 9 findings and owns no file.
    //        `src/a.ts` holds 5 findings and owns a row of exactly 5.
    const stale = { eslint: 9, eslintErrors: 0 };
    const rows = { 'src/a.ts': { eslint: 5, eslintErrors: 0 }, 'src/gone.ts': stale };
    const afterDelete = mod.judgeFindingsTable({
      measured: new Map([['src/a.ts', verdict(5)]]),
      table: rows
    });
    // when: `src/a.ts` is renamed ONTO that name, carrying its 5 findings with it
    const afterRename = mod.judgeFindingsTable({
      measured: new Map([['src/gone.ts', verdict(5)]]),
      table: rows
    });
    // and: 4 more findings then arrive on the name the rename landed on
    const afterGrowth = mod.judgeFindingsTable({
      measured: new Map([['src/gone.ts', verdict(9)]]),
      table: rows
    });
    // then: NOTHING refuses at any of the three steps. The row outlives its file, the
    //       rename makes the stale row measurable again, and its unused remainder (9 − 5)
    //       is capacity an individual finding can be spent in — the shape the named table
    //       was adopted to remove. `unmeasured` is where the slack is VISIBLE, and it is
    //       the only sentence the gate prints about it: a count, never a refusal. It reads
    //       1 at every step and names a DIFFERENT row each time — `src/gone.ts` while its
    //       file is gone, then `src/a.ts`, the source whose 5 findings the table still
    //       claims after they moved.
    expect(afterDelete.failures).toEqual([]);
    expect(afterDelete.unmeasured).toBe(1);
    expect(afterRename.failures).toEqual([]);
    expect(afterRename.unmeasured).toBe(1);
    expect(afterGrowth.failures).toEqual([]);
    expect(afterGrowth.unmeasured).toBe(1);
    expect(afterGrowth.totals.findings).toBe(9);
    // WHY THE EXISTING GUARDS MISS IT, so a reader does not go looking for one:
    // `.husky/monotonic/rows.mjs` refuses a row that moves UP, and no row moved here;
    // the row for `src/a.ts` is never measured, so it cannot descend; and the totals the
    // count rows bound are not what refused a valid reshuffle in the first place. Closing
    // this needs identity across renames, which the census does not record — recorded as a
    // decision with this probe rather than closed, per the slice's own brief.
  });
});

// ---------------------------------------------------------------------------
// THE GATE ARMS — the real process, over a table the real generator seeded
// ---------------------------------------------------------------------------
const PLANTED_REL = 'src/dirty-one.ts';
const TIDY_REL = 'src/tidy.ts';
const ESLINT_BIN_REL = join('node_modules', 'eslint', 'bin', 'eslint.js');

/**
 * The fixture's eslint, replaced for these arms: ONE warning-severity finding on the
 * file whose basename starts with `token`, none anywhere else. Severity 1 deliberately —
 * an error would move the `eslintErrors` row as well, and this arm is about the
 * findings row. Every argv file gets a report, so `notLinted` stays where the seed put it.
 */
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
    fx = createFixture('findings-table');
    // A prettier-clean one-liner whose findings the seed will NAME: the row for this
    // file is the tolerance arm 4 leans on, and arm 5 moves it away from the file.
    fx.write(PLANTED_REL, 'export const dirtyOne = 1;\n');
    fx.write(ESLINT_BIN_REL, eslintStubFor('dirty-one'));
    fx.commitAll('fixture: one planted file whose findings the seeded table will name');
  }
  return fx;
}

/** The row the seeded table wrote for `file`, or undefined when it names no such path. */
function seededRow(file: string): { eslint: number; eslintErrors: number } | undefined {
  const doc = JSON.parse(readFileSync(fixture().artifactPath, 'utf8')) as {
    files: Record<string, { eslint: number; eslintErrors: number }>;
  };
  return doc.files[file];
}

beforeAll(async () => {
  mod = (await import(pathToFileURL(join(REPO_ROOT, MODULE_REL)).href)) as FindingsTableModule;
  const seed = fixture().runGenerator(['--seed']);
  expect(seed.code, seed.out).toBe(0);
});

afterAll(() => {
  fx?.cleanup();
});

describe('Scenario: integration — the gate judges the rows the generator seeded', () => {
  it(
    'F: when a file the table NAMES holds findings, should hold the row and say the names are the assertion',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: the seeded table, whose row for the planted file is the measured count.
      const row = seededRow(PLANTED_REL);
      expect(row, 'the seed wrote a row for the planted file').toBeDefined();
      expect(row?.eslint, 'the row is the number the seed measured').toBe(1);
      // when: `repo` mode runs against that table
      const run = runRepoMode(fixture());
      // then: it holds — a named file is tolerated — and the run says the NAMES are the
      //       assertion rather than leaving a bare total to be read as one
      expect(run.code, run.out).toBe(0);
      expect(run.out).toContain('eslint findings (derived)');
      expect(run.out).toContain('the NAMES are the assertion');
      expect(run.out).toContain('tolerating findings');
    }
  );

  it(
    'G: when the SAME total moves between two rows, should refuse naming the row that grew',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: the finding moves from the named file to `src/tidy.ts`, which the table
      //        names at ZERO — the total is unchanged at 1, so the old count form was green.
      const row = seededRow(TIDY_REL);
      expect(row?.eslint, 'the seed named the tidy row at zero').toBe(0);
      writeFileSync(join(fixture().root, ESLINT_BIN_REL), eslintStubFor('tidy'), 'utf8');
      // when: `repo` mode runs against the same table and the same total
      const run = runRepoMode(fixture());
      // then: the derived total is still inside its ceiling — the count form's whole
      //       claim — while the run refuses BY NAME, and the file that gave the finding
      //       up is reported as the descent that keeps the table pointable
      expect(run.out, run.out).toContain('1   (ceiling 1)');
      expect(run.code, run.out).toBe(1);
      expect(run.out).toContain('src/tidy.ts');
      expect(run.out).toContain('went from 0 to 1 lint finding(s)');
      expect(run.out).toContain('push blocked');
      expect(run.out).toContain('came in BELOW their row');
      expect(run.out).toContain('src/dirty-one.ts');
    }
  );

  it(
    'H: when a named file gives its findings up entirely, should pass and report the descent',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: the named file's findings are gone — the whole-file case of "clean one old
      //        file", with nothing added anywhere to absorb it.
      writeFileSync(join(fixture().root, ESLINT_BIN_REL), eslintStubFor('no-file'), 'utf8');
      // when: `repo` mode runs
      const run = runRepoMode(fixture());
      // then: the run PASSES — a ratchet that refused its own descent would be a demand
      //       for a clean repository, which is the failure mode this table exists to avoid
      expect(run.code, run.out).toBe(0);
      expect(run.out).toContain('0   (ceiling 1)');
      expect(run.out).toContain('came in BELOW their row');
      expect(run.out).toContain('src/dirty-one.ts');
    }
  );
});
