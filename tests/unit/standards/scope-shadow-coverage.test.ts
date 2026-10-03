// tests/unit/standards/scope-shadow-coverage.test.ts
//
// The POSITIVE CONTROLS for the two-population reconciliation of
// `file-size-cap.test.ts` (rid `2026-10-03-w10-rescope-a` repair 1). An arm that
// cannot go red is not an arm: before the rescope, the census population and the
// artifact row population were the SAME set, and the F4 guard compared them
// directly. They are now deliberately different (1495 counted / 943 gated / 552
// shadow), and the replacement invariant is STRICTER — it constrains not just
// "no in-scope file is missing" but "every omission is exactly what the shadow
// block claims". This file is where each direction of that claim is watched
// failing ON PURPOSE: a fixture artifact with an in-scope row dropped, a counted
// file added to the census without a shadow claim, and — the control that keeps
// the other two honest — the real repository, unchanged, proving the checker
// says nothing when the books balance.
//
// WHY A FILE OF ITS OWN. `file-size-cap.test.ts` sits at 500 raw against the
// tests cap; hoisting the controls here is the posture `gate-module-set.test.ts`
// and `gate-module-staging.test.ts` established. No file is written into the
// repository: the "fixture artifact" arms hand the pure checker document objects
// directly, so no scratch tree and no real `.git` is involved.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { BASELINE_PATH, censusCountedFiles, REPO_ROOT } from './_file-size-cap-scan.js';
import {
  baselineCoverageProblems,
  coverageProblems,
  shadowBlock,
  type ArtifactDocument
} from './_scope-shadow-coverage.js';

declareDimensions(
  'tests/unit/standards/scope-shadow-coverage.test.ts',
  ['behavior', 'integration'],
  [
    {
      dim: 'render',
      reason: 'the checker returns records, not text; the arm messages it feeds live in `file-size-cap.test.ts`'
    },
    {
      dim: 'a11y',
      reason: 'no operator-facing output originates here; the generator stderr line is guarded by `baseline-rescope-guard.test.ts`'
    }
  ]
);

const always = (ok: boolean) => (): boolean => ok;

describe('Scenario: behavior — the checker goes red on a planted accounting defect', () => {
  it('control (a): an in-scope file whose row was dropped from a fixture artifact is kind 1', async () => {
    const counted = ['src/a.ts', 'src/b.ts', 'tests/x.test.ts'];
    const shadow = { scopeDirs: ['tests'], measuredFiles: 1 };
    // GREEN BASELINE first: the same inputs with every in-scope row present.
    // Without this the red below could be the checker reporting nothing at all.
    const balanced: ArtifactDocument = {
      files: { 'src/a.ts': {}, 'src/b.ts': {} },
      shadow
    };
    expect(await coverageProblems(balanced, counted)).toEqual({
      inScopeMissing: [],
      unaccounted: [],
      countProblem: null
    });
    // PLANT: drop `src/b.ts`'s row — the 2026-09-30 shape (1424 entries against a
    // 1429-file scope) — and the arm must name it as kind 1, not as "a file with
    // no row that is nobody's problem".
    const planted: ArtifactDocument = { files: { 'src/a.ts': {} }, shadow };
    const problems = await coverageProblems(planted, counted);
    expect(problems.inScopeMissing).toEqual(['src/b.ts']);
    expect(problems.unaccounted).toEqual([]);
    // The counts catch it too: rows + shadow no longer equals the counted set.
    expect(problems.countProblem).not.toBeNull();
  });

  it('control (b): a counted out-of-scope file the shadow does not claim is kind 2', async () => {
    const counted = ['src/a.ts', 'tests/x.test.ts', 'scripts/y.mjs'];
    // The shadow knows about `tests/` only — `scripts/y.mjs` is omitted AND
    // unclaimed, which is exactly "a file vanished from the artifact" wearing
    // the exemption's clothes.
    const planted: ArtifactDocument = {
      files: { 'src/a.ts': {} },
      shadow: { scopeDirs: ['tests'], measuredFiles: 1 }
    };
    const problems = await coverageProblems(planted, counted);
    expect(problems.inScopeMissing).toEqual([]);
    expect(problems.unaccounted).toEqual(['scripts/y.mjs']);
    expect(problems.countProblem).not.toBeNull();
    // And claiming it — both by dir and by count — is what makes it green again.
    const claimed: ArtifactDocument = {
      files: { 'src/a.ts': {} },
      shadow: { scopeDirs: ['scripts', 'tests'], measuredFiles: 2 }
    };
    expect(await coverageProblems(claimed, counted)).toEqual({
      inScopeMissing: [],
      unaccounted: [],
      countProblem: null
    });
  });

  it('refuses a shadow block that is absent or malformed instead of reading it as zero', () => {
    // §2.41's shape again: "nothing claimed" and "no claim exists" must not
    // converge — a pre-rescope artifact has NO shadow, and the reader throws.
    expect(() => shadowBlock({ files: {} })).toThrow('no `shadow` block');
    expect(() => shadowBlock({ shadow: { scopeDirs: 'tests', measuredFiles: 1 } })).toThrow(
      'scopeDirs'
    );
    expect(() => shadowBlock({ shadow: { scopeDirs: ['tests'] } })).toThrow('measuredFiles');
  });

  it('keeps kind 1 and kind 2 separate when a boundary flip moves a file between them', () => {
    // The same omission, two boundaries: under the wide (pre-rescope) rule every
    // file is in scope, so it is a missing row; under the narrow rule it is an
    // omission the shadow must claim. Only a checker whose kinds are computed
    // from the RULE can say both.
    const counted = ['src/a.ts', 'src/b.ts'];
    const args = (scoped: boolean) => ({
      counted,
      rowFiles: ['src/a.ts'],
      shadow: { scopeDirs: ['src'], measuredFiles: 1 },
      inEnforcedScope: always(scoped)
    });
    expect(baselineCoverageProblems(args(true)).inScopeMissing).toEqual(['src/b.ts']);
    expect(baselineCoverageProblems(args(true)).unaccounted).toEqual([]);
    expect(baselineCoverageProblems(args(false)).inScopeMissing).toEqual([]);
    // Under the narrow rule `src/b.ts` is out-of-scope; the shadow claims one
    // file rooted in `src`, so it is accounted for — a DIFFERENT verdict, not a
    // second name for the same one.
    expect(baselineCoverageProblems(args(false)).unaccounted).toEqual([]);
    expect(baselineCoverageProblems(args(false)).countProblem).toBeNull();
  });
});

describe('Scenario: integration — the real repository, unchanged, is green and not vacuously', () => {
  it('control (c): the published artifact passes the same checker the planted defects fail', async () => {
    const artifact = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as ArtifactDocument;
    const counted = censusCountedFiles(REPO_ROOT);
    const problems = await coverageProblems(artifact, counted);
    expect(
      problems.inScopeMissing,
      `in-scope file(s) with no files[] row: ${problems.inScopeMissing.join(', ')}`
    ).toEqual([]);
    expect(problems.unaccounted, `unclaimed omissions: ${problems.unaccounted.join(', ')}`).toEqual(
      []
    );
    expect(problems.countProblem).toBeNull();
    // NON-VACUITY: the shadow population is real (hundreds of files), the rows
    // are a strict subset of the counted set, and the checker actually walked
    // both — an empty checker run over empty inputs would fail these.
    const shadow = shadowBlock(artifact);
    expect(shadow.measuredFiles).toBeGreaterThan(100);
    expect(Object.keys(artifact.files ?? {}).length).toBeGreaterThan(900);
    expect(Object.keys(artifact.files ?? {}).length + shadow.measuredFiles).toBe(counted.length);
  });
});
