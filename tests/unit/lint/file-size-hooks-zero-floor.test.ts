// tests/unit/lint/file-size-hooks-zero-floor.test.ts
//
// Rid `2026-10-02-wave9-file-size-split` (wave 9, slice 4 of 4) — the first ceiling
// in this campaign that can only be broken by NEW debt.
//
// WHY THIS ARM EXISTS. `fileSizeHooksOverCap` ratchets the count of `.husky/` files
// over the 300-line hooks cap. Slices 1–3 pulled the three big gate modules under it;
// this slice splits the last one (`peaks-gate-file-size.mjs`, 411). With every `.husky`
// file at or under cap, the row sits at a measured **0** for the first time. A ceiling
// that has been at zero earns its keep only if a NEW over-cap `.husky` file reddens it
// — that is the ratchet's whole purpose, and no earlier arm could show it (before this
// split the tree itself kept the row above zero). F4 of the brief asks for exactly that
// demonstration, and the staging machinery walks `.husky/`, so an added file appears
// without editing any list.
//
// EVERY ARM RUNS IN A FIXTURE REPOSITORY (`_file-size-hooks-fixture.ts`), the same shape
// `file-size-hooks-gate-leg.test.ts` uses: the real generator seeds the real census of
// the fixture's tree (so `0` is MEASURED, never typed), and the real gate leg is spawned
// against that artifact. Nothing is written into this repository.

import { afterAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import {
  HOOKS_OVER_CAP_KEY,
  HOOKS_OVER_CAP_ROW,
  createFixture,
  rowFor,
  type Fixture,
  type FixtureArtifact
} from './_file-size-hooks-fixture.js';
import { FILE_SIZE_CAP_HOOKS } from '../../../src/services/scan/file-size-policy.js';

declareDimensions(
  'tests/unit/lint/file-size-hooks-zero-floor.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason:
        'the printed breach line is asserted under a11y; this slice adds no stdout-shape-only surface.'
    }
  ]
);

const fixture: Fixture = createFixture('fs-zero-floor');

afterAll(() => {
  fixture.cleanup();
});

/**
 * The fixture, cleared of its own synthetic over-cap hooks file and seeded, so the
 * `.husky/` scope is exactly the split working tree: entry + five siblings, all ≤ 300.
 * The returned artifact's `fileSizeHooksOverCap` is what the generator MEASURED there.
 */
let zeroSeeded: FixtureArtifact | null = null;
function seededAtZero(): FixtureArtifact {
  if (zeroSeeded === null) {
    // The fixture pre-writes one over-cap hooks guard (`hooks-big.mjs`); taking it out
    // leaves a `.husky/` whose only members are the real, now-split modules.
    fixture.removeHooksFile('hooks-big.mjs');
    const run = fixture.runGenerator(['--seed']);
    if (run.code !== 0) throw new Error(`the fixture seed run must write:\n${run.out}`);
    zeroSeeded = fixture.artifact();
  }
  return zeroSeeded;
}

describe('Scenario: behavior — a row that sits at a measured zero', () => {
  it(
    'when every .husky file is at or under the cap, the census, the seed and the leg all report zero',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // Seeding takes the fixture's synthetic over-cap guard out and re-measures, so the
      // `.husky/` scope below is exactly the split working tree: entry + five siblings,
      // all at or under 300. Do that FIRST — the zero is about that cleared tree.
      const artifact = seededAtZero();
      // Anti-vacuity: the zero is not assumed. The census really counts the split tree
      // and finds no over-cap file — if any sibling were over 300 it would appear here.
      const measured = fixture.census().hooks;
      expect(measured.overCap, 'census hooks overCap').toBe(0);
      expect(measured.excessLines, 'census hooks excessLines').toBe(0);
      expect(measured.files, 'census named no over-cap .husky file').toEqual([]);

      // The seeded ceiling is that measured zero, and the leg holds against it.
      expect(artifact.ceilings[HOOKS_OVER_CAP_KEY], 'seeded ceiling').toBe(0);
      const run = fixture.runGate([]);
      expect(run.code, run.out).toBe(0);
      expect(run.out).toContain('file-size ceiling held');
      const row = rowFor(run.out, HOOKS_OVER_CAP_ROW);
      expect(row.mark, run.out).toBe('✓');
      expect(row.actual).toBe(0);
      expect(row.ceiling).toBe(0);
    }
  );
});

describe('Scenario: integration — one new over-cap .husky file reddens the row', () => {
  it(
    'when a fresh .husky file crosses the cap on a tree whose row was at zero, the leg goes RED and exits 1',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      seededAtZero();
      fixture.addHooksFile('late-over-cap.mjs', FILE_SIZE_CAP_HOOKS + 1);
      try {
        // The census now sees exactly one over-cap hooks file; the ceiling it is checked
        // against is the zero it was seeded at, so the row flips on NEW debt alone.
        expect(fixture.census().hooks.overCap).toBe(1);
        const run = fixture.runGate([]);
        expect(run.code, run.out).toBe(1);
        expect(run.out).not.toContain('file-size ceiling held');
        const row = rowFor(run.out, HOOKS_OVER_CAP_ROW);
        expect(row.mark, run.out).toBe('✗');
        expect(row.actual).toBe(1);
        expect(row.ceiling).toBe(0);
      } finally {
        // Put the tree back: the breach must be the added file, not drift — and the next
        // arm (and any re-run) sees the zero the seed measured, not a lingering +1.
        fixture.removeHooksFile('late-over-cap.mjs');
      }
    }
  );

  it(
    'when the added file is taken back out, the row holds at zero again',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      seededAtZero();
      const held = fixture.runGate([]);
      expect(held.code, held.out).toBe(0);
      expect(rowFor(held.out, HOOKS_OVER_CAP_ROW).actual).toBe(0);
    }
  );
});

describe('Scenario: a11y — what the zero-floor breach says to a human', () => {
  it(
    'when the row goes red from zero, it names the row, the +1 delta and the do-not-raise instruction',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      seededAtZero();
      fixture.addHooksFile('late-over-cap.mjs', FILE_SIZE_CAP_HOOKS + 1);
      try {
        const run = fixture.runGate([]);
        expect(run.code, run.out).toBe(1);
        expect(run.out).toContain(`${HOOKS_OVER_CAP_ROW}: 1 > ceiling 0 (+1)`);
        expect(run.out).toContain('do not raise the ceiling');
        expect(run.out).toContain('hooks scope note');
      } finally {
        fixture.removeHooksFile('late-over-cap.mjs');
      }
    }
  );
});
