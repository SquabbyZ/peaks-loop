// tests/unit/lint/baseline-rescope-leg-scope.test.ts
//
// Rid `2026-10-03-silent-warning-scope-repair1` D2 — the arms the parent slice's
// mechanism was built for but never got (backlog §2.43). The predecessor implemented
// the whole-scope comparison (`.husky/baseline/rescope.mjs`), the per-leg record
// (`.husky/baseline/leg-scope.mjs`) and the boundary-attributed raise
// (`.husky/baseline/decide.mjs`), and then died before writing a single arm that runs
// them. `grep -c silentWarning baseline-rescope-guard.test.ts` was 0: the dirs-move
// guard had no coverage of the OTHER way a boundary moves. THIS file is that coverage.
//
// WHY A SIBLING AND NOT THE DIRS FILE. `baseline-rescope-guard.test.ts` proves the
// gate-wide `scope.dirs` narrowing refuses without `--rescope`. A leg-population move
// is the opposite shape: `scope.dirs` holds still (the lint scope stays 943) while ONE
// leg starts measuring 38 files it never opened, and its two ceilings rise with
// ZERO new debt. Proving that needs the REAL detector measuring a REAL tracked
// population, so this rides `_silent-warning-scope-fixture.ts`'s `createDetectorFixture`
// (the harness the fixture header already names as its second consumer) rather than the
// guard's argv-blind stub.
//
// THE FOUR ARMS, each read against the fixture's OWN measurement (never a typed
// number, §2.41), and A3 is the positive control that makes A1/A4 non-vacuous: the
// SAME generator on the SAME tree exits 0 when nothing moved, so a refusal there is
// caused by the population moving, not by an empty fixture.
//   A1. HEAD records a SMALLER silent-warning population + two lower ceilings; the run
//       measures more. Without `--rescope`: exit 1, the refusal names WHICH leg moved
//       and BOTH population counts, ties each ceiling rise to that leg, says the scope
//       itself did not move, and leaves the artifact byte-identical (sha256 before == after).
//   A2. The same state WITH `--rescope`: exit 0, both ceilings rise to the measurement,
//       and the new `scope.silentWarning.scannedFiles` is recorded — the flag is how a
//       boundary move is stated, and after it the same run is ordinary (see A3).
//   A3. A recorded population EQUAL to the run: a plain regeneration is permitted
//       (exit 0, no refusal), and `--rescope` there is itself refused — "nothing to
//       rescope". The flag is required, not cosmetic.
//   A4. A HEAD artifact with NO `scope.silentWarning` is UNKNOWN, not zero: the rise is
//       refused without the flag (the message says "unknown", never `0 -> N`), and the
//       bytes are untouched — the posture §2.43 demands of a missing record.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import { type Fixture } from './_file-size-hooks-fixture.js';
import {
  KEY_EMPTY,
  KEY_NULL,
  artifactScope,
  artifactSha,
  catchReturnNullSource,
  createDetectorFixture,
  emptyCatchSource,
  recordedLegScope
} from './_silent-warning-scope-fixture.js';

declareDimensions(
  'tests/unit/lint/baseline-rescope-leg-scope.test.ts',
  ['behavior', 'integration', 'render', 'a11y'],
  []
);

/** A tracked, lint-scoped file carrying BOTH rules so neither ceiling is a vacuous zero. */
const DEBT_REL = 'src/legscope-debt.ts';

let fx: Fixture | null = null;
function fixture(): Fixture {
  if (fx === null) {
    fx = createDetectorFixture('leg-scope');
    fx.write(DEBT_REL, `${emptyCatchSource(4)}${catchReturnNullSource(4)}`);
    fx.commitAll('fixture: one tracked lint-scoped file, 4 empty-catch + 4 return-null swallows');
  }
  return fx;
}

type Doc = { ceilings: Record<string, number> };

/**
 * The fixture's TRUE measurement, captured once from a `--seed` run. `POP` / `E` / `N`
 * are what the leg actually counts over this repository's tracked scope; every arm
 * rebuilds HEAD by moving these real numbers, so no test types a population it did not
 * measure.
 */
let POP = 0;
let E = 0;
let N = 0;
let SRC = '';
let base: Record<string, unknown> | null = null;

beforeAll(() => {
  const seed = fixture().runGenerator(['--seed']);
  expect(seed.code, seed.out).toBe(0);
  base = fixture().artifactDocument();
  const rec = recordedLegScope(fixture(), 'silentWarning');
  if (rec === null || base === null) {
    throw new Error('the seed run wrote no silent-warning population record');
  }
  POP = rec.scannedFiles;
  SRC = rec.source;
  const cl = (base as unknown as Doc).ceilings;
  // `noUncheckedIndexedAccess` makes a `Record<string, number>` index `number |
  // undefined`, and this slice must not seed a measurement from a value it did not
  // read: a missing row throws rather than defaulting to 0 (§2.41).
  const measured = (key: string): number => {
    const value = cl[key];
    if (typeof value !== 'number')
      throw new Error(`the seed measured no numeric ceiling at ${key}`);
    return value;
  };
  E = measured(KEY_EMPTY);
  N = measured(KEY_NULL);
  expect(E, 'a real empty-catch population the arms can rise from').toBeGreaterThanOrEqual(4);
  expect(N, 'a real return-null population the arms can rise from').toBeGreaterThanOrEqual(4);
  expect(POP, 'a real recorded population, not an empty fixture').toBeGreaterThanOrEqual(3);
});

afterAll(() => {
  fx?.cleanup();
});

/**
 * Rewrite HEAD's committed artifact to the seed's measurement with the LEG record and
 * its two rows moved, and everything else byte-identical. `pop === null` drops
 * `scope.silentWarning` entirely (the unknown-posture arm). Returns nothing: the arms
 * read state back through the fixture helpers, not through a restated number.
 */
function craftHead(pop: number | null, empty: number, nul: number): void {
  if (base === null) throw new Error('no baseline measurement captured');
  const doc = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
  const scope = doc.scope as Record<string, unknown>;
  if (pop === null) delete scope.silentWarning;
  else scope.silentWarning = { source: SRC, scannedFiles: pop };
  const cl = doc.ceilings as Record<string, number>;
  cl[KEY_EMPTY] = empty;
  cl[KEY_NULL] = nul;
  fixture().writeArtifact(doc);
  fixture().commitAll('fixture: HEAD crafted for a leg-population boundary arm');
}

describe('Scenario: integration — a moved leg population is a boundary, not a regression', () => {
  it(
    'A1: without --rescope the leg-population move exits 1, names the leg and both counts, ties the ceiling rise, and leaves the bytes untouched',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      craftHead(POP - 2, E - 1, N - 1);
      expect(
        recordedLegScope(fixture(), 'silentWarning')?.scannedFiles,
        'the crafted HEAD record'
      ).toBe(POP - 2);
      const before = artifactSha(fixture());

      const refused = fixture().runGenerator([]);
      expect(refused.code, refused.out).toBe(1);
      expect(refused.out).toContain('REFUSING to write');
      expect(refused.out).toContain('SCOPE CHANGE');
      expect(refused.out).toContain('not a reduction in debt');
      // Which leg moved, and BOTH of its population counts.
      expect(refused.out).toContain(
        `silent-warning leg population: ${String(POP - 2)} -> ${String(POP)}`
      );
      // The gate-wide scope did NOT move — only this leg's population did.
      expect(refused.out).toContain("what moved is a LEG's own population");
      // The ceiling rise is tied to that leg, named with its own before/after numbers.
      expect(refused.out).toContain(`${KEY_EMPTY}: ${String(E - 1)} -> ${String(E)}`);
      expect(refused.out).toContain(`${KEY_NULL}: ${String(N - 1)} -> ${String(N)}`);

      const after = artifactSha(fixture());
      expect(after, 'the refusal happens before a byte changes').toBe(before);
    }
  );

  it(
    'A2: with --rescope the boundary is stated: exit 0, both ceilings rise to the measurement, and the new population is recorded',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // A1 already left HEAD on the pre-widening record and its refused run wrote no
      // byte, so the flag operates on that exact state — the same pairing
      // `baseline-rescope-guard.test.ts` uses for the dirs move.
      expect(
        recordedLegScope(fixture(), 'silentWarning')?.scannedFiles,
        'HEAD is still pre-widening'
      ).toBe(POP - 2);
      const res = fixture().runGenerator(['--rescope']);
      expect(res.code, res.out).toBe(0);
      expect(res.out).toContain('RESCOPE applied');
      // The attribution: a row rose because ITS leg population moved, and that is the
      // same debt over more files, not new debt.
      expect(res.out).toContain('zero new debt');
      expect(res.out).toContain('silent-warning leg population');

      expect(
        recordedLegScope(fixture(), 'silentWarning')?.scannedFiles,
        'the widened population is recorded'
      ).toBe(POP);
      const cl = (fixture().artifactDocument() as unknown as Doc).ceilings;
      expect(cl[KEY_EMPTY], 'the empty-catch ceiling is now the measurement').toBe(E);
      expect(cl[KEY_NULL], 'the return-null ceiling is now the measurement').toBe(N);
      // The fifteen ceilings stay a scope block, not a sixteenth ceiling.
      expect(artifactScope(fixture())).not.toHaveProperty(KEY_EMPTY);
    }
  );
});

describe('Scenario: behavior — the flag is required, not cosmetic (A3 is A1/A4 positive control)', () => {
  it(
    'A3: with the recorded population EQUAL to the run an ordinary regeneration is permitted and --rescope is refused as nothing to rescope',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // HEAD now records exactly what the run measures: no move, no boundary.
      craftHead(POP, E, N);

      const plain = fixture().runGenerator([]);
      expect(plain.code, plain.out).toBe(0);
      expect(plain.out).not.toContain('REFUSING');
      expect(plain.out).not.toContain('SCOPE CHANGE');

      const overuse = fixture().runGenerator(['--rescope']);
      expect(overuse.code, overuse.out).toBe(1);
      expect(overuse.out).toContain('REFUSING to write');
      expect(overuse.out).toContain('nothing to rescope');
    }
  );

  it(
    'A4: a HEAD artifact with NO silent-warning record is unknown, not zero — the rise is refused without the flag and the bytes stay untouched',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      craftHead(null, E - 1, N - 1);
      expect(
        recordedLegScope(fixture(), 'silentWarning'),
        'HEAD names no population at all'
      ).toBeNull();
      const before = artifactSha(fixture());

      const refused = fixture().runGenerator([]);
      expect(refused.code, refused.out).toBe(1);
      expect(refused.out).toContain('SCOPE CHANGE');
      // The absent record reads as "unknown", never as a prior population of 0.
      expect(refused.out).toContain('silent-warning leg population: unknown');
      expect(refused.out).not.toContain('silent-warning leg population: 0 ->');
      expect(refused.out).toContain(`-> ${String(POP)}`);
      // The rise is not waved through as if the prior population were zero.
      expect(refused.out).toContain(`${KEY_EMPTY}: ${String(E - 1)} -> ${String(E)}`);

      const after = artifactSha(fixture());
      expect(after, 'an unknown population cannot make a rise look legal').toBe(before);
    }
  );
});
