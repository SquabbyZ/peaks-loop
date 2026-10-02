// tests/unit/lint/baseline-monotonicity.test.ts
//
// Rid 2026-10-02-baseline-monotonicity (backlog §2.27) — the ratchet baseline may
// only descend, and until this slice that sentence lived only in the `note` string
// the generator wrote into its own artifact.
//
// THE DEFECT, MEASURED 2026-10-01. C wave 7 staged 29 files of which seven were
// not prettier-formatted. `node .husky/peaks-gate-baseline.mjs` regenerated
// `.peaks/lint/gate-baseline.json`, raised `prettierUnformatted` 0 → 7, printed
// `wrote .peaks/lint/gate-baseline.json` and exited **0**. Nothing in the
// generator read the previous artifact back, so there was no number to compare
// against: the ratchet moved up and the only thing that noticed was a human
// diffing the artifact key by key.
//
// WHAT THIS FILE HOLDS. `.husky/peaks-gate-baseline-monotonic.mjs` is the pure
// comparison the generator calls immediately before it writes, and every row of
// its decision table is a named arm below — including the two rows that must
// STILL WRITE. `tests/unit/lint/baseline-monotonicity-generator.test.ts` runs the
// generator as a subprocess against an isolated fixture and proves the refusal
// lands before the bytes change; the split is the `tests/` raw-line cap, not a
// change of subject.
//
// WHY A CONTROL IS AN ARM AND NOT A COMMENT. A guard that refuses on all inputs
// is a broken instrument, and a decision table asserted only by its refusals
// cannot tell the two apart. Arm A3 therefore takes ONE input pair — the same
// measurement with one key bumped up, and that key back at the old value — and
// requires opposite verdicts from it. The sibling file repeats the shape through
// the real process.
//
// THE CANONICAL KEY LIST (rid 2026-10-02-monotonicity-head-anchor, repair cycle 1 of
// §2.27). C wave 8 anchored the comparison in the working-tree artifact — the file a
// weakening edits — and an out-of-band review measured three ways past it. The anchor
// moved to `git show HEAD:.peaks/lint/gate-baseline.json`, and the thirteen ceiling
// names moved into ONE exported list compared by SET EQUALITY: nothing constrained the
// key set before (a fourteenth or renamed row was accepted by construction), and the
// row `1b` this file used to write filtered non-numeric entries out and asserted
// `>= 13`, so a junk row in the published artifact vanished instead of reddening it.
// The working-copy attacks and the two-run happy path are
// `tests/unit/lint/baseline-monotonicity-head-anchor.test.ts`'s subject.
//
// Dimensions:
//   - behavior: the decision table, row by row, on the pure comparison
//   - render:      omitted — the refusal and the descent notes are asserted as
//                  the generator actually prints them, in the sibling file
//   - integration: omitted — the subprocess, the fixture repository and the
//                  artifact bytes are the sibling file's subject
//   - a11y:        omitted — the exit code and the operator-facing sentence are
//                  asserted where the process produces them, in the sibling

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/lint/baseline-monotonicity.test.ts',
  ['behavior'],
  [
    {
      dim: 'render',
      reason: 'the printed refusal and the descent notes are asserted in the sibling file'
    },
    {
      dim: 'integration',
      reason: 'the generator subprocess and the artifact bytes are the sibling file'
    },
    { dim: 'a11y', reason: 'exit codes are asserted where the real process produces them' }
  ]
);

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const MONOTONIC_MODULE = join(REPO_ROOT, '.husky', 'peaks-gate-baseline-monotonic.mjs');
/** The key 2026-10-01 moved (0 → 7), used as the single moved key in the arms. */
const RAISED_KEY = 'prettierUnformatted';

// ---------------------------------------------------------------------------
// The comparison module, typed at its own boundary
// ---------------------------------------------------------------------------

type Ceilings = Record<string, number>;
type Delta = { key: string; previous: number; next: number };
type AddedRow = { key: string; next: number };
type RemovedRow = { key: string; previous: number };
type InvalidRow = { key: string; side: string; value: string; why: string };
type Decision = {
  ok: boolean;
  raised: Delta[];
  lowered: Delta[];
  added: AddedRow[];
  removed: RemovedRow[];
  invalid: InvalidRow[];
};
type KeyProblem = { key: string; side: string; problem: string };
type CanonicalKeyOptions = { allowMissing?: boolean };
type MonotonicModule = {
  compareCeilings(previous: Record<string, unknown>, next: Record<string, unknown>): Decision;
  parsePreviousArtifact(text: string): { ceilings: Ceilings | null; problem: string | null };
  CEILING_KEYS?: readonly string[];
  canonicalKeyProblems?: (
    side: string,
    ceilings: Record<string, unknown>,
    options?: CanonicalKeyOptions
  ) => KeyProblem[];
  unseedableKeys?: (
    head: Record<string, unknown>,
    workingCopy: Record<string, unknown> | null
  ) => KeyProblem[];
};

/** The module is a `.mjs` gate script outside `src/`, so it loads by URL. */
async function loadMonotonic(): Promise<MonotonicModule> {
  return (await import(pathToFileURL(MONOTONIC_MODULE).href)) as MonotonicModule;
}

/** The canonical-list surface, with its three exports named where they are required. */
async function loadCanonical(): Promise<{
  keys: readonly string[];
  problems: NonNullable<MonotonicModule['canonicalKeyProblems']>;
  unseedable: NonNullable<MonotonicModule['unseedableKeys']>;
}> {
  const module = await loadMonotonic();
  expect(
    Array.isArray(module.CEILING_KEYS),
    'the monotonicity module must export CEILING_KEYS, the one canonical ceiling key list'
  ).toBe(true);
  expect(typeof module.canonicalKeyProblems, 'canonicalKeyProblems must be a function').toBe(
    'function'
  );
  expect(typeof module.unseedableKeys, 'unseedableKeys must be a function').toBe('function');
  return {
    keys: module.CEILING_KEYS ?? [],
    problems: module.canonicalKeyProblems ?? (() => []),
    unseedable: module.unseedableKeys ?? (() => [])
  };
}

/** A stand-in for a measured vector: each arm moves one key of it and nothing else. */
const BASE: Ceilings = {
  eslintFindings: 20,
  eslintErrors: 4,
  prettierUnformatted: 2,
  tscErrors: 0,
  fileSizeExcessLines: 77
};

const keysOf = (rows: Array<{ key: string }>): string[] => rows.map((row) => row.key).sort();

// ---------------------------------------------------------------------------
// The published artifact and HEAD's copy of it, read — never written. Nothing
// here filters a value out before comparing: an entry the comparison should
// refuse on is exactly the entry a filter used to make invisible.
// ---------------------------------------------------------------------------

type PublishedArtifact = { ceilings: Record<string, unknown> };
/** The path the way git spells it — the anchor the generator now reads. */
const ARTIFACT_GIT_PATH = '.peaks/lint/gate-baseline.json';

function ceilingsOf(document: string): Record<string, unknown> {
  return (JSON.parse(document) as PublishedArtifact).ceilings;
}

/** The rows the ratchet carries today, unfiltered. */
function publishedCeilings(): Record<string, unknown> {
  return ceilingsOf(readFileSync(join(REPO_ROOT, '.peaks', 'lint', 'gate-baseline.json'), 'utf8'));
}

/** The same file as HEAD holds it — read the way `.husky/peaks-gate-baseline.mjs` reads it. */
function headCeilings(): Record<string, unknown> {
  return ceilingsOf(
    execFileSync('git', ['show', `HEAD:${ARTIFACT_GIT_PATH}`], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024
    })
  );
}

const sortedKeys = (ceilings: Record<string, unknown>): string[] => Object.keys(ceilings).sort();

describe('Scenario: behavior — the decision table row by row', () => {
  it('row 1 — when every ceiling key is equal, should compare clean and permit the write', async () => {
    const decision = (await loadMonotonic()).compareCeilings(BASE, { ...BASE });
    expect(decision.ok, JSON.stringify(decision)).toBe(true);
    expect(keysOf(decision.raised)).toEqual([]);
    expect(keysOf(decision.lowered)).toEqual([]);
    expect(keysOf(decision.added)).toEqual([]);
    expect(keysOf(decision.removed)).toEqual([]);
    expect(keysOf(decision.invalid)).toEqual([]);
  });

  it('row 1b — on the published artifact compared against itself, should permit the write for every row it really carries', async () => {
    // The input is the real vector UNFILTERED, not the stand-in and not the
    // numeric subset: a junk or string-valued row in the published artifact has
    // to redden this arm, not disappear from the comparison.
    const published = publishedCeilings();
    const decision = (await loadMonotonic()).compareCeilings(published, { ...published });
    expect(decision.invalid, JSON.stringify(decision.invalid)).toEqual([]);
    expect(decision.ok, JSON.stringify(decision)).toBe(true);
    expect(keysOf(decision.raised)).toEqual([]);
  });

  it('row 2 — when a ceiling is strictly lower, should permit the write and record which keys went down', async () => {
    const clearedDebt = { ...BASE, [RAISED_KEY]: 5, tscErrors: 1 };
    const decision = (await loadMonotonic()).compareCeilings(clearedDebt, BASE);
    expect(decision.ok, JSON.stringify(decision)).toBe(true);
    expect(keysOf(decision.raised)).toEqual([]);
    expect(keysOf(decision.lowered)).toEqual([RAISED_KEY, 'tscErrors']);
    expect(decision.lowered[0]).toEqual({ key: RAISED_KEY, previous: 5, next: 2 });
  });

  it('row 3 — when a pre-existing ceiling is higher, should refuse and name it with its old and new numbers', async () => {
    // The 2026-10-01 event in one line: seven unformatted files measured against
    // a ceiling of zero, and the generator called that a baseline.
    const decision = (await loadMonotonic()).compareCeilings(
      { ...BASE, [RAISED_KEY]: 0 },
      { ...BASE, [RAISED_KEY]: 7 }
    );
    expect(decision.ok, JSON.stringify(decision)).toBe(false);
    expect(keysOf(decision.raised)).toEqual([RAISED_KEY]);
    expect(decision.raised[0]).toEqual({ key: RAISED_KEY, previous: 0, next: 7 });
  });

  it('row 3b — when several ceilings rise at once, should name every one of them', async () => {
    const decision = (await loadMonotonic()).compareCeilings(
      { ...BASE, eslintErrors: 1, tscErrors: 0 },
      { ...BASE, eslintErrors: 2, tscErrors: 3 }
    );
    expect(decision.ok, JSON.stringify(decision)).toBe(false);
    expect(keysOf(decision.raised)).toEqual(['eslintErrors', 'tscErrors']);
    expect(keysOf(decision.lowered)).toEqual([]);
  });

  it('row 4 — when a key is new to the measurement, should permit the write and record it as a newly seeded row, never as silent equality', async () => {
    // How `fileSizeExcessLines` was seeded on 2026-10-01: the previous artifact
    // simply did not carry the key. That is the hole a raised ceiling escapes
    // through as "unrecognized", so an unmatched key must be NAMED as added —
    // `raised` staying empty is what makes the two cases distinguishable.
    const previous: Record<string, unknown> = { ...BASE };
    delete previous.fileSizeExcessLines;
    const decision = (await loadMonotonic()).compareCeilings(previous, BASE);
    expect(decision.ok, JSON.stringify(decision)).toBe(true);
    expect(keysOf(decision.added)).toEqual(['fileSizeExcessLines']);
    expect(decision.added[0]).toEqual({ key: 'fileSizeExcessLines', next: 77 });
    expect(keysOf(decision.raised)).toEqual([]);
  });

  it('row 5 — when a previous key is missing from the measurement, should refuse: dropping a ceiling is the loudest possible weakening', async () => {
    // Row 4 read backwards. A measurement that stops reporting a ceiling it used
    // to report has not cleared that debt; it has stopped watching it.
    const dropped: Record<string, unknown> = { ...BASE };
    delete dropped.fileSizeExcessLines;
    const decision = (await loadMonotonic()).compareCeilings(BASE, dropped);
    expect(decision.ok, JSON.stringify(decision)).toBe(false);
    expect(keysOf(decision.removed)).toEqual(['fileSizeExcessLines']);
    expect(decision.removed[0]).toEqual({ key: 'fileSizeExcessLines', previous: 77 });
  });

  it('row 6 — when the previous artifact is unreadable or unparseable, should report a problem instead of an empty baseline', async () => {
    const module = await loadMonotonic();
    const unparseable = module.parsePreviousArtifact('{ not JSON, and no ratchet\n');
    expect(unparseable.ceilings).toBeNull();
    expect(unparseable.problem ?? '').toContain('JSON');
    const shapeless = module.parsePreviousArtifact('{"version": 3}\n');
    expect(shapeless.ceilings).toBeNull();
    expect(shapeless.problem ?? '').toContain('ceilings');
    const emptyFile = module.parsePreviousArtifact('');
    expect(emptyFile.ceilings).toBeNull();
    expect(emptyFile.problem ?? '').not.toBe('');
    const good = module.parsePreviousArtifact('{"ceilings":{"prettierUnformatted":0}}\n');
    expect(good.problem, good.problem ?? '').toBeNull();
    expect(good.ceilings).toEqual({ [RAISED_KEY]: 0 });
  });

  it('row 6b — when the caller opted into seeding, should compare an absent baseline as every row newly seeded', async () => {
    // The opt-in is the only way a corrupt or absent artifact may be
    // re-baselined, and it must be REPORTED as seeding: thirteen added rows is
    // also what a first-ever run looks like, so the two have to stay tellable
    // apart in the log. `compareCeilings({}, next)` is that shape.
    const decision = (await loadMonotonic()).compareCeilings({}, BASE);
    expect(decision.ok, JSON.stringify(decision)).toBe(true);
    expect(keysOf(decision.added)).toEqual(Object.keys(BASE).sort());
    expect(keysOf(decision.raised)).toEqual([]);
    expect(keysOf(decision.removed)).toEqual([]);
  });

  it('row 7 — when a ceiling is not a finite non-negative integer, should refuse and name the side it came from', async () => {
    const module = await loadMonotonic();
    const broken: Array<[string, unknown]> = [
      ['negative', -1],
      ['fractional', 0.5],
      ['NaN', Number.NaN],
      ['infinite', Number.POSITIVE_INFINITY],
      ['a string', '7'],
      ['null', null],
      ['absent', undefined],
      ['an object', { value: 3 }]
    ];
    for (const [shape, value] of broken) {
      const measured = module.compareCeilings(BASE, { ...BASE, tscErrors: value });
      expect(measured.ok, `measured ${shape}: ${JSON.stringify(measured)}`).toBe(false);
      expect(keysOf(measured.invalid), `measured ${shape}`).toEqual(['tscErrors']);
      expect(measured.invalid[0]?.side, shape).toContain('measured');
      const inherited = module.compareCeilings({ ...BASE, tscErrors: value }, BASE);
      expect(inherited.ok, `previous ${shape}`).toBe(false);
      expect(inherited.invalid[0]?.side, shape).toContain('previous');
    }
    // The control for the same shape: an integer on both sides is not invalid,
    // and a string "2" is not accepted just because it reads like a number.
    expect((await loadMonotonic()).compareCeilings(BASE, BASE).invalid).toEqual([]);
  });

  it('row 7b — an unparseable previous artifact must not reach the comparison as an empty one', async () => {
    // The bridge between rows 6 and 7. The generator only ever calls the
    // comparison with what `parsePreviousArtifact` handed back, and a `null`
    // slipped through instead would read as "no previous ceilings" — row 6b's
    // seed, with no opt-in and no operator in the loop. So the comparison refuses
    // a non-object rather than deciding what a null was meant to mean.
    const module = await loadMonotonic();
    expect(module.parsePreviousArtifact('').ceilings).toBeNull();
    expect(() => module.compareCeilings(null as unknown as Ceilings, BASE)).toThrowError();
  });

  it('A3 control — the same measurement refuses with one key bumped and writes with that key back at the old value', async () => {
    // The arm that separates a guard from an outage: identical inputs except one
    // number, opposite verdicts. If the comparison rejected everything, the
    // second half of this arm would be red; if it noticed nothing, the first.
    const module = await loadMonotonic();
    const next = { ...BASE };
    const bumped = module.compareCeilings({ ...BASE, [RAISED_KEY]: 1 }, next);
    expect(bumped.ok, 'one unformatted file above the ceiling must refuse').toBe(false);
    expect(keysOf(bumped.raised)).toEqual([RAISED_KEY]);
    const held = module.compareCeilings({ ...BASE, [RAISED_KEY]: 2 }, next);
    expect(held.ok, 'the same key AT the old value must write').toBe(true);
    expect(keysOf(held.raised)).toEqual([]);
    expect(keysOf(held.lowered)).toEqual([]);
    expect(keysOf(held.added)).toEqual([]);
  });
});

describe('Scenario: behavior — the comparison decides from its arguments alone', () => {
  it('should answer identically when called twice with the same vectors, because it owns no state', async () => {
    // Anti-side-effect arm. The generator calls this comparison while holding the
    // only write path to the published artifact, so a comparison that read or
    // wrote anything could judge a number that is not the one it was handed.
    const module = await loadMonotonic();
    const first = module.compareCeilings(BASE, { ...BASE, eslintErrors: 2 });
    const second = module.compareCeilings(BASE, { ...BASE, eslintErrors: 2 });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.ok).toBe(true);
    expect(keysOf(first.lowered)).toEqual(['eslintErrors']);
  });
});

// ---------------------------------------------------------------------------
// The canonical key list. `13 rows, two places` is the problem this campaign keeps
// hitting: the generator assembles the rows and something else is supposed to know
// what they are. One exported list, compared by SET EQUALITY (never `>= 13`), is
// what makes adding a row in one place and not the other a red test.
// ---------------------------------------------------------------------------

const problemKeys = (problems: KeyProblem[]): string[] => problems.map((row) => row.key).sort();

async function canonicalVector(
  overrides: Record<string, unknown> = {},
  dropped: readonly string[] = []
): Promise<Record<string, unknown>> {
  const { keys } = await loadCanonical();
  const vector: Record<string, unknown> = Object.fromEntries(keys.map((key) => [key, 0] as const));
  for (const [key, value] of Object.entries(overrides)) vector[key] = value;
  for (const key of dropped) delete vector[key];
  return vector;
}

describe('Scenario: behavior — one canonical ceiling key list, compared by set equality', () => {
  it('C1 — the list should name each ceiling key exactly once, the published artifact should carry exactly those keys, and HEAD should carry a subset of them', async () => {
    const { keys } = await loadCanonical();
    const unique = [...new Set(keys)].sort();
    expect(keys.length, `CEILING_KEYS carries a duplicate: ${keys.join(', ')}`).toBe(unique.length);
    expect(unique.length).toBeGreaterThan(0);
    // The published artifact is the generator's own output, so it gets no waiver: a row
    // it does not carry is a row nobody measured. The list's strictness lives here.
    expect(sortedKeys(publishedCeilings())).toEqual(unique);
    // HEAD is allowed to lag the list, in exactly one direction. A ceiling row is born
    // measured into the working copy BEFORE HEAD knows it exists — backlog §2.35 defers
    // an added disk row to the measurement instead of refusing it — so pinning HEAD to
    // `unique` asserted something the seeding path makes temporarily false on every slice
    // that adds a row. What may never differ is WHICH rows HEAD carries: a row not on
    // the list, invented or renamed, is a defect whether or not HEAD has caught up with
    // the list yet. Once the seed is committed the two sets are equal again and this arm
    // has said nothing either way; C4 holds the rows HEAD does carry to a real ceiling.
    const headKeys = sortedKeys(headCeilings());
    const offList = headKeys.filter((key) => !unique.includes(key));
    expect(offList, `HEAD carries row(s) no slice sanctioned: ${offList.join(', ')}`).toEqual([]);
  });

  it('C2 — a vector carrying a row that is not on the list should report that key with the side it came from', async () => {
    const { problems } = await loadCanonical();
    const measured = problems('measured by this run', await canonicalVector({ extra: 4 }));
    expect(problemKeys(measured)).toEqual(['extra']);
    expect(measured[0]?.side).toBe('measured by this run');
    expect(measured[0]?.problem).toMatch(/canonical/i);
    const head = problems('HEAD artifact', await canonicalVector({ legacyRow: 1 }));
    expect(problemKeys(head)).toEqual(['legacyRow']);
    expect(head[0]?.side).toBe('HEAD artifact');
  });

  it('C3 — a canonical row a vector does not carry should be reported, and only the anchor side may ask for that report to be waived', async () => {
    const { problems } = await loadCanonical();
    const dropped = problems('measured by this run', await canonicalVector({}, ['tscErrors']));
    expect(problemKeys(dropped)).toEqual(['tscErrors']);
    expect(dropped[0]?.problem).toMatch(/missing/i);
    // The waiver is for HEAD's short artifact — the seeding row — and it waives
    // nothing else: an extra or a bad value is still reported with it on.
    expect(
      problems('HEAD artifact', await canonicalVector({}, ['tscErrors']), { allowMissing: true })
    ).toEqual([]);
    expect(
      problemKeys(
        problems('HEAD artifact', await canonicalVector({ junk: 7 }), { allowMissing: true })
      )
    ).toEqual(['junk']);
  });

  it('C4 — a value that is not a finite non-negative integer should be reported on the side it came from, including in the published artifact', async () => {
    const { problems } = await loadCanonical();
    const broken: Array<[string, unknown]> = [
      ['a string', '7'],
      ['null', null],
      ['undefined', undefined],
      ['an object', { value: 3 }],
      ['negative', -1],
      ['fractional', 0.5],
      ['NaN', Number.NaN],
      ['infinite', Number.POSITIVE_INFINITY]
    ];
    for (const [shape, value] of broken) {
      const found = problems('the published artifact', await canonicalVector({ tscErrors: value }));
      expect(problemKeys(found), `published ${shape}`).toEqual(['tscErrors']);
      expect(found[0]?.problem, shape).not.toBe('');
    }
    // The real data, unfiltered: this is what secondary defect (b) was — a junk
    // row the old comparison sorted out of existence instead of refusing.
    expect(problems('the published artifact', publishedCeilings())).toEqual([]);
    // HEAD gets the anchor's waiver, and only for absence: a canonical row it has not
    // carried yet is a row awaiting its first seeding (C1), while every row it DOES
    // carry has to be on the list and has to hold a finite non-negative integer — true
    // with the seed uncommitted, and still true after the commit makes the sets equal.
    expect(problems('HEAD artifact', headCeilings(), { allowMissing: true })).toEqual([]);
  });

  it('C5 — a row HEAD does not carry is seedable only when the working copy does not carry it either', async () => {
    // `fileSizeExcessLines` was seeded on 2026-10-01 by a run whose previous
    // artifact simply did not have the key. Anchoring in HEAD must keep that door
    // open, and keep it open only for a key neither side already carries.
    const { unseedable, keys } = await loadCanonical();
    const fresh = 'fileSizeExcessLines';
    expect(keys).toContain(fresh);
    const headWithout = await canonicalVector({}, [fresh]);
    expect(unseedable(headWithout, headWithout)).toEqual([]);
    expect(unseedable(headWithout, null)).toEqual([]);
    const blocked = unseedable(headWithout, await canonicalVector({ [fresh]: 9 }));
    expect(problemKeys(blocked)).toEqual([fresh]);
    expect(blocked[0]?.problem).toMatch(/HEAD/);
    expect(blocked[0]?.problem).toMatch(/working copy/i);
    expect(unseedable(await canonicalVector(), await canonicalVector())).toEqual([]);
  });
});
