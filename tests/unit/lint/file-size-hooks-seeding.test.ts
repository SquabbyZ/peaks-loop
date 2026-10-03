// tests/unit/lint/file-size-hooks-seeding.test.ts
//
// Rid `2026-10-02-hooks-size-rows` (backlog §2.32), the change-control half: the two
// new ceiling rows have to survive the generator, the canonical key list, and the
// real tree — in that order.
//
// WHY THE DOUBLE RUN IS THE ARM. `fileSizeHooksOverCap` and
// `fileSizeHooksExcessLines` are the first real use of the ceiling-seeding path
// backlog §2.35 built minutes ago. That entry's defect was specific: a slice that
// introduces a ceiling row could regenerate ONCE, and the second regeneration before
// its commit refused with a remedy — `git checkout HEAD -- .peaks/lint/gate-baseline.json`
// — that would have deleted the row it was refusing. So the acceptance test for this
// slice is not "the generator writes two rows", it is "the generator writes them
// TWICE and exits 0 both times", in a fixture, never against the published artifact.
//
// WHAT IS REAL HERE AND WHAT IS A FIXTURE. The fixture under OS tmp copies the actual
// generator, the actual monotonicity module, the actual census and the actual policy
// module, and forwards `node_modules/tsx` to the repository's real tsx, so the rows it
// seeds are measured by the same code the orchestrator will run. The published
// `.peaks/lint/gate-baseline.json` is READ — never written — by the last two arms.
//
// THE KEY LIST IS THE DOOR, AND IT IS ALSO THE AUDIT. `CEILING_KEYS` grows 13 → 15.
// Growing it while the artifact carries 13 rows is not a weakening: it is the state
// between the slice and the seeding run, and
// `tests/unit/lint/baseline-monotonicity.test.ts` arm C1 reddens on exactly that
// disagreement (artifact-vs-list set equality, both in the working copy and at HEAD)
// until the seeded artifact is committed. The arms below pin the half of that C1
// cannot: that the two new keys are ON the list, that a measurement which stops
// reporting them is refused, and that a hand-typed one is refused too.
//
// Dimensions:
//   - integration: two generator runs in a fixture, one artifact at HEAD, and the real
//                  tree's numbers reproduced by a walk that never read them
//   - behavior:    the new rows under the decision table — added, dropped, hand-typed
//   - render:      the seeding lines an operator reads
//   - a11y:        the refusal wording that names which keys are missing

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import {
  HOOKS_EXCESS_KEY,
  HOOKS_OVER_CAP_KEY,
  HOOKS_WHOLE_SCOPE_SOURCE,
  MAIN_OVER_CAP_KEY,
  createFixture,
  publishedHooksCeilings,
  publishedMainCeilings,
  realCensus,
  walkHooksScope,
  type FixtureArtifact
} from './_file-size-hooks-fixture.js';
import { monotonicModuleTextUnder } from './_monotonic-module-set.js';
import { REPO_ROOT, generatorModuleTextUnder } from '../standards/_file-size-cap-scan.js';
import {
  FILE_SIZE_CAP_HOOKS,
  HOOKS_FILE_SIZE_SCOPE_DIRS,
  isPolicyMeasuredFile
} from '../../../src/services/scan/file-size-policy.js';

declareDimensions(
  'tests/unit/lint/file-size-hooks-seeding.test.ts',
  ['integration', 'behavior', 'render', 'a11y'],
  []
);

const fixture = createFixture('hooks-seeding');
const MONOTONIC_REL = join('.husky', 'peaks-gate-baseline-monotonic.mjs');

afterAll(() => {
  fixture.cleanup();
});

type Ceilings = Record<string, number>;

function ceilingsOf(document: Record<string, unknown>): Ceilings {
  return document.ceilings as Ceilings;
}

/**
 * The fixture's own fifteen measurements, learned from one `--seed` run into a HEAD
 * that carries no artifact. Nothing below types a ceiling: the vectors the arms move
 * are this run's numbers with one key changed.
 */
let measured: Ceilings | null = null;

function measuredCeilings(): Ceilings {
  if (measured === null) {
    const seeded = fixture.runGenerator(['--seed']);
    if (seeded.code !== 0) throw new Error(`the fixture seed run must write:\n${seeded.out}`);
    measured = ceilingsOf(fixture.artifactDocument());
    expect(Object.keys(measured)).toContain(HOOKS_OVER_CAP_KEY);
    expect(Object.keys(measured)).toContain(HOOKS_EXCESS_KEY);
  }
  return measured;
}

/** The measured vector with rows moved or dropped, never retyped from prose. */
function ceilingsLike(overrides: Ceilings = {}, dropped: readonly string[] = []): Ceilings {
  const merged: Record<string, number | undefined> = { ...measuredCeilings(), ...overrides };
  for (const key of dropped) delete merged[key];
  return Object.fromEntries(
    Object.entries(merged).filter((entry) => entry[1] !== undefined)
  ) as Ceilings;
}

/** Put HEAD's artifact at `ceilings`, so the anchor is a git object and not an edit. */
function anchorHeadAt(ceilings: Ceilings): void {
  const document = fixture.artifactDocument();
  fixture.writeArtifact({ ...document, ceilings });
  fixture.commitAll('fixture: HEAD carries the anchor');
}

function runGenerator(args: readonly string[] = []): { code: number; out: string } {
  const run = fixture.runGenerator(args);
  return { code: run.code, out: run.out };
}

type MonotonicModule = {
  CEILING_KEYS: readonly string[];
  canonicalKeyProblems(
    side: string,
    ceilings: Record<string, unknown>,
    options?: { allowMissing?: boolean }
  ): Array<{ key: string; side: string; problem: string }>;
};

async function loadMonotonic(): Promise<MonotonicModule> {
  return (await import(pathToFileURL(join(fixture.root, MONOTONIC_REL)).href)) as MonotonicModule;
}

// ── integration: the seeding path, twice ──────────────────────────────

describe('Scenario: integration — the generator seeds the two rows and can be run again', () => {
  it(
    'when a slice adds two canonical rows, should seed them on the first run and keep exiting 0 on the second and third',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const over = measuredCeilings()[HOOKS_OVER_CAP_KEY];
      const excess = measuredCeilings()[HOOKS_EXCESS_KEY];
      expect(typeof over).toBe('number');
      expect(typeof excess).toBe('number');
      // HEAD and the disk both carry the thirteen rows the previous slice seeded.
      anchorHeadAt(ceilingsLike({}, [HOOKS_OVER_CAP_KEY, HOOKS_EXCESS_KEY]));

      const first = runGenerator();
      expect(first.code, first.out).toBe(0);
      expect(first.out).toContain('NEWLY SEEDED');
      expect(first.out).toContain(HOOKS_OVER_CAP_KEY);
      expect(first.out).toContain(HOOKS_EXCESS_KEY);
      const written = ceilingsOf(fixture.artifactDocument());
      expect(written[HOOKS_OVER_CAP_KEY]).toBe(over);
      expect(written[HOOKS_EXCESS_KEY]).toBe(excess);

      // THE DEFECT §2.35 WAS ABOUT: this second run used to refuse, because the disk
      // now carried a row HEAD does not, and the advice it printed would have deleted
      // the row the first run measured.
      const second = runGenerator();
      expect(second.code, second.out).toBe(0);
      expect(second.out).not.toContain('REFUSING');
      expect(JSON.stringify(ceilingsOf(fixture.artifactDocument()))).toBe(JSON.stringify(written));
      expect(second.out).toMatch(/measures the same number/);
      expect(second.out, 'a permitted path prints no restore advice').not.toMatch(
        /git checkout HEAD/
      );

      const third = runGenerator();
      expect(third.code, third.out).toBe(0);
      expect(JSON.stringify(ceilingsOf(fixture.artifactDocument()))).toBe(JSON.stringify(written));
    }
  );

  it('carries both rows in the artifact with their own recorded inputs', () => {
    measuredCeilings();
    const document = fixture.artifactDocument();
    const inputs = (document.fileSizePolicyInputs ?? {}) as Record<string, unknown>;
    // A ceiling whose inputs can be re-decided underneath it is not a ratchet, so the
    // hooks block is bound the same way the main pair is: cap, dirs, extensions, unit.
    expect(inputs.hooksCap).toBe(FILE_SIZE_CAP_HOOKS);
    expect(inputs.hooksScopeDirs).toEqual([...HOOKS_FILE_SIZE_SCOPE_DIRS]);
    expect(Array.isArray(inputs.hooksScopeExtensions)).toBe(true);
    expect(typeof inputs.hooksLineConvention).toBe('string');
    expect(String(inputs.hooksLineConvention)).toBe(realCensus().hooks.convention);
    expect(typeof ceilingsOf(document)[HOOKS_OVER_CAP_KEY]).toBe('number');
  });
});

// ── behavior: the new rows under the same decision table ──────────────

describe('Scenario: behavior — the new rows are ordinary ceilings, not exempt ones', () => {
  it(
    'when the disk hands a hooks row a number this run did not measure, should refuse naming both values',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const over = measuredCeilings()[HOOKS_OVER_CAP_KEY];
      // The arm is about MOVING a measured row, so the row has to have been measured:
      // `ceilingsLike` would happily type `undefined + 5` into the vector as NaN, and
      // the refusal below would then be about a junk value instead of about a row this
      // run did not measure. A guard, not a `!`: the type already says this can be
      // absent, and the fixture seeding nothing is a real state (the artifact write is
      // what makes it not one).
      if (typeof over !== 'number') {
        throw new Error(`the fixture measured no ceiling at "${HOOKS_OVER_CAP_KEY}"`);
      }
      // THE STATE THIS ARM IS ABOUT is the one `tests/unit/lint/baseline-monotonicity-seeding.test.ts`
      // S4b builds: HEAD does NOT carry the row yet, and the disk carries it at a number
      // this run does not measure. Anchoring HEAD AT the measured row would be a different
      // verdict — the lift-vs-anchor branch, where `git checkout HEAD` is the correct
      // remedy and the arm below would be asserting the wrong thing. The row is real debt
      // only while the anchor lacks it, so the anchor has to lack it.
      anchorHeadAt(ceilingsLike({}, [HOOKS_OVER_CAP_KEY, HOOKS_EXCESS_KEY]));
      const document = fixture.artifactDocument();
      const typed = ceilingsLike({ [HOOKS_OVER_CAP_KEY]: over + 5 });
      fixture.writeArtifact({ ...document, ceilings: typed });
      const run = runGenerator();
      expect(run.code, run.out).toBe(1);
      expect(run.out).toContain('REFUSING to write');
      expect(run.out).toContain(HOOKS_OVER_CAP_KEY);
      // The arm's own name promises BOTH values, and an arm that only greps for the key
      // would pass on a refusal that named neither number.
      expect(run.out, 'both sides, or the operator cannot tell which is which').toMatch(
        new RegExp(`${HOOKS_OVER_CAP_KEY}[^\\n]*disk ${over + 5}`)
      );
      expect(run.out).toMatch(new RegExp(`measured by this run ${over}`));
      expect(run.out).toMatch(/measurement decides/);
      expect(
        run.out,
        'a row this run measures is real debt; restore advice would delete it'
      ).not.toMatch(/git checkout|restor/i);
      // Leave the fixture's artifact as the seeding run wrote it — the full fifteen-row
      // measurement, not the thirteen-row anchor this arm dropped from HEAD. The arms
      // after this one read the fixture's artifact as "what the generator measured", and
      // a fixture left on a thirteen-row disk would make the next arm assert about my
      // cleanup instead of about the generator.
      fixture.writeArtifact({ ...document, ceilings: ceilingsLike() });
    }
  );

  it(
    'when a run stops measuring a hooks row, should refuse it as a dropped canonical key',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const monotonic = await loadMonotonic();
      const keys = [...monotonic.CEILING_KEYS];
      expect(keys.length).toBe(new Set(keys).size);
      expect(keys).toContain(HOOKS_OVER_CAP_KEY);
      expect(keys).toContain(HOOKS_EXCESS_KEY);
      // Set equality, never a count: a junk row and a missing row cancel in a count.
      const dropped = monotonic.canonicalKeyProblems('measured by this run', ceilingsLike());
      expect(dropped).toEqual([]);
      const short = monotonic.canonicalKeyProblems(
        'measured by this run',
        ceilingsLike({}, [HOOKS_EXCESS_KEY])
      );
      expect(short.map((problem) => problem.key)).toEqual([HOOKS_EXCESS_KEY]);
      expect(short[0]?.problem).toMatch(/missing/i);
      // A vector that is short of the two new rows is the state between this slice and
      // the seeding run. The anchor side may waive a missing row — that is how a new
      // ceiling gets seeded — but a MEASUREMENT may not, so the same vector is refused
      // when it comes from a run. `tests/unit/lint/baseline-monotonicity.test.ts` arm
      // C1 pins the published disagreement itself until the seeded artifact is
      // committed; these are the halves it cannot see.
      const 十三 = ceilingsLike({}, [HOOKS_OVER_CAP_KEY, HOOKS_EXCESS_KEY]);
      expect(monotonic.canonicalKeyProblems('HEAD artifact', 十三, { allowMissing: true })).toEqual(
        []
      );
      expect(
        monotonic
          .canonicalKeyProblems('measured by this run', 十三)
          .map((p) => p.key)
          .sort()
      ).toEqual([HOOKS_EXCESS_KEY, HOOKS_OVER_CAP_KEY]);
    }
  );

  it('keeps the two hooks rows before fileSizeExcessLines in the generator and the list', () => {
    // Not cosmetics: `tests/unit/lint/baseline-monotonicity-seeding.test.ts` patches a
    // copy of the key list and of the generator's assembled rows onto their LAST key,
    // and a row appended after `fileSizeExcessLines` silently un-anchors that guard —
    // its own fixture would then be measuring a thirteen-row generator.
    // Pooled over the walked monotonic set: the list is ONE contiguous literal in
    // exactly one module of it (the sibling helper throws otherwise), so the ORDER
    // this arm guards survives the wave 9 slice 2 split without naming the sibling.
    const keys = monotonicModuleTextUnder(fixture.root);
    const at = (needle: string): number => keys.indexOf(needle);
    expect(at(`'${HOOKS_OVER_CAP_KEY}'`)).toBeGreaterThan(-1);
    expect(at(`'${HOOKS_EXCESS_KEY}'`)).toBeLessThan(at("'fileSizeExcessLines'"));
    // Pooled over the walked GENERATOR set, the same way (rid wave 9 slice 3): the rows
    // are one contiguous literal in one module of it, so this order survives the split.
    const generator = generatorModuleTextUnder(fixture.root);
    expect(generator.indexOf('fileSizeHooksExcessLines:')).toBeLessThan(
      generator.indexOf('fileSizeExcessLines: size.env.excessLines')
    );
  });
});

// ── render / a11y: the real tree, and what the rows say about it ──────

describe('Scenario: a11y — the published rows agree with the real .husky, walked', () => {
  it(
    'when the hooks rows are seeded, should carry exactly what a fresh census and an independent walk report',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // This arm is the one that cannot pass before the orchestrator's seeding run:
      // `publishedHooksCeilings()` refuses to invent a ceiling the artifact does not
      // hold. Everything it needs is already measured and asserted green elsewhere —
      // the walk, the census, and the fixture's own seeded rows.
      const published = publishedHooksCeilings();
      const env = realCensus();
      const walked = walkHooksScope(REPO_ROOT);
      expect(env.hooks.scope.source).toBe(HOOKS_WHOLE_SCOPE_SOURCE);
      expect(published.overCap).toBe(env.hooks.overCap);
      expect(published.excessLines).toBe(env.hooks.excessLines);
      expect(walked.overCap).toBe(env.hooks.overCap);
      expect(walked.excessLines).toBe(env.hooks.excessLines);
    }
  );

  it('leaves the two main ceilings exactly where they were, and the hooks scope outside them', async () => {
    // The premise of the whole slice: the new pair must not move the old one.
    // Rid `2026-10-03-w10-rescope-a` narrowed WHAT the main ceilings count: the
    // census still counts the whole universe, the ceilings ratchet its ENFORCED
    // part, so "exactly where they were" is now said against the same envelope
    // cut by the shared partition — not against the raw universe totals.
    const main = publishedMainCeilings();
    const env = realCensus();
    const { partitionCensusOverCap } = (await import(
      pathToFileURL(join(REPO_ROOT, '.husky', 'peaks-gate-file-size.mjs')).href
    )) as {
      // Property spelling, not a method signature: this arm destructures it, and
      // `@typescript-eslint/unbound-method` flags unbound references to anything
      // typed as a method (repair 1 of the rescope).
      partitionCensusOverCap: (e: unknown) => { gated: { overCap: number; excessLines: number } };
    };
    const gated = partitionCensusOverCap(env).gated;
    expect(main.overCap).toBe(gated.overCap);
    expect(main.excessLines).toBe(gated.excessLines);
    // And the main scope still refuses `.husky/` — no path is counted twice, which is
    // what makes this a second scope and not the scope-dir edit it was not allowed to be.
    for (const file of env.hooks.files) {
      expect(isPolicyMeasuredFile(file.file), file.file).toBe(false);
      expect(file.file.startsWith('.husky/'), file.file).toBe(true);
    }
    expect(ceilingsOf(fixture.artifactDocument())[MAIN_OVER_CAP_KEY]).toBeLessThanOrEqual(
      main.overCap
    );
    expect(env.scope.dirs).not.toContain('.husky');
    expect(env.hooks.scope.dirs).not.toContain('src');
    const seeded: FixtureArtifact = fixture.artifact();
    expect(Object.keys(seeded.ceilings).length).toBe(15);
  });
});
