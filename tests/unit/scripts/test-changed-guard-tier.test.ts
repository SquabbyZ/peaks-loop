/**
 * tests/unit/scripts/test-changed-guard-tier.test.ts
 *
 * THE TIER EVERY SUBSET CARRIES. `scripts/test-changed-classify.mjs` unions its tier into every
 * `subset` verdict, so a diff that only edits existing files reaches the two whole-tree suites:
 * their subject is the repository tree, and the area rule maps `src/<area>` to `tests/unit/<area>`,
 * so a scoped run cannot cover them by construction. A slice whose scoped run misses them ships a
 * red guard past every reviewer and QA.
 *
 * THE ROOT OF `tests/unit/` IS THE SAME TIER, IN THE ONE PLACE THE AREA RULE CANNOT REACH. It maps
 * an area to a SUBDIRECTORY, so a test file at the ROOT has no area and nothing selects it — and
 * the guards whose subject is the whole tree live there. s10 shipped a defect in a new test file
 * that only the root's spawn-hygiene ratchet catches, and four reviewers, QA and both tiers were
 * blind to it. The union's third member is `ROOT_TIER_SELECTOR`, a SELECTOR rather than a
 * directory, and `scripts/test-changed-root-tier.mjs` owns the rule that expands it — from a
 * DIRECTORY LISTING, so a guard added at the root is selected the day it is created.
 *
 * WHY THIS IS A SIBLING FILE rather than more arms in `test-changed-classify.test.ts`: that file is
 * over its own file-size cap, and the census counts raw lines, so one more arm there would move a
 * ratcheted total. The split is therefore a budget decision, stated rather than implied — the
 * classifier's arms stay where they were, and this rule owns a file with room.
 *
 * THE PLANT IS THE REQUIREMENT. An arm that reads a rule out of the module proves the rule is
 * present, not that the arm could fail. So `loadPlantedUnion` imports a copy of the module with the
 * union REMOVED, `loadPlantedRootTier` a copy with the root's member removed, and the arms are
 * re-asked against both; a guard that stays green when the mechanism is deleted is vacuous. Each
 * plant THROWS when its anchor is gone, so a refactor cannot silently disarm it and leave its arm
 * green.
 *
 * Dimensions: `render` is omitted (the classifier renders nothing — its verdict is an object and
 * the runner's narration is asserted in the sibling file) and `a11y` is omitted for the same
 * reason (no human-facing text is produced here).
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/scripts/test-changed-guard-tier.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'the classifier renders nothing — its verdict is an object' },
    {
      dim: 'a11y',
      reason: 'no human-facing text; the runner narration is test-changed-classify.test.ts'
    }
  ]
);

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const MODULE_REL = 'scripts/test-changed-classify.mjs';
const MODULE_URL = pathToFileURL(join(REPO_ROOT, MODULE_REL)).href;
const ROOT_TIER_REL = 'scripts/test-changed-root-tier.mjs';
const ROOT_TIER_URL = pathToFileURL(join(REPO_ROOT, ROOT_TIER_REL)).href;
const UNIT_ROOT = join(REPO_ROOT, 'tests', 'unit');

type Entry = { status?: string; path?: string };
type Plan = { mode: 'full' | 'none' | 'subset'; paths: string[]; code: string; reasons: string[] };
type ClassifyModule = {
  BASELINE_REL: string;
  LINT_GUARD_PATH: string;
  ROOT_TIER_SELECTOR: string;
  STANDARDS_GUARD_PATH: string;
  GATE_GUARD_SUITES: readonly string[];
  classifyChanged(entries: readonly Entry[], options?: { baselineContentMoved?: boolean }): Plan;
};
type RootTierModule = {
  expandRootTier(paths: readonly string[], rootListing: readonly string[]): string[];
};

const SCRATCH = mkdtempSync(join(tmpdir(), 'peaks-guard-tier-'));

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

async function loadModule(): Promise<ClassifyModule> {
  return (await import(MODULE_URL)) as ClassifyModule;
}

async function loadRootTier(): Promise<RootTierModule> {
  return (await import(ROOT_TIER_URL)) as RootTierModule;
}

/** The root's entries, read off the disk exactly as the runner reads them. */
function rootListing(): string[] {
  return readdirSync(UNIT_ROOT);
}

/** The root's own `*.test.ts` files as PATHS — read off the disk, never typed into an arm. */
function rootTierFiles(): string[] {
  return rootListing()
    .filter((name) => name.endsWith('.test.ts'))
    .map((name) => `tests/unit/${name}`);
}

/**
 * The plan's selection expanded the way the RUNNER expands it: the classifier's `paths` go in, the
 * root selector comes out as the files the directory actually holds. A classifier-only arm cannot
 * see this step — vitest's filter is a `String.includes`, so the selector is a rule, not a path —
 * and an arm that stops at `paths` proves a string is present, not that a test runs.
 */
async function expandPlan(plan: Plan): Promise<string[]> {
  const root = await loadRootTier();
  return root.expandRootTier(plan.paths, rootListing());
}

/**
 * Every shape that reaches `mode: 'subset'`, one row each, with the SHAPE named rather than the
 * path: a failure has to say which route to a subset stopped carrying the tier. The first row is
 * the hole this rule closes — a content-only edit to an already-tracked file in a mapped area.
 */
const SUBSET_SHAPES: ReadonlyArray<readonly [string, Entry]> = [
  ['a content-only edit in a mapped area', { status: 'M', path: 'src/cli/commands/example.ts' }],
  ['a content-only edit to a test file', { status: 'M', path: 'tests/unit/services/x.test.ts' }],
  ['an edit to the census policy', { status: 'M', path: 'src/services/scan/file-size-policy.ts' }],
  ['a moved gate artifact', { status: 'M', path: '.peaks/lint/gate-baseline.json' }]
];

/**
 * The rows the plant must redden. Two rules ALSO reach a guard directory (R1 names both, R3 names
 * the standards one), so those rows stay green under the plant for a reason that has nothing to do
 * with the union — asserting them there would prove the rule fired, not that the arm rests on the
 * union. These two rows are the routes where NO rule adds a guard, which is where the union is the
 * only selector, and they are the shapes a slice that edits a couple of files actually produces.
 */
const UNION_ONLY_ROWS = SUBSET_SHAPES.slice(0, 2);

// ---------------------------------------------------------------------------
// behavior — the tier rides every subset, whatever selected the subset
// ---------------------------------------------------------------------------

describe('Scenario: behavior — the whole-tree guard tier rides every subset verdict', () => {
  it.each(SUBSET_SHAPES)(
    'when the diff is %s, should select both guard directories',
    async (_shape, entry) => {
      // given: one route to `mode: 'subset'`, with the baseline read as content-moved
      // when:  the pre-push classifier classifies it
      // then:  both whole-tree suites are in the plan — for EVERY route, not only the ones a
      //        file-set change or a moved gate artifact reaches
      const mod = await loadModule();
      const plan = mod.classifyChanged([entry], { baselineContentMoved: true });

      expect(plan.mode, 'the tier is an addition to a subset, never the whole suite').toBe(
        'subset'
      );
      expect(plan.paths).toContain(mod.STANDARDS_GUARD_PATH);
      expect(plan.paths).toContain(mod.LINT_GUARD_PATH);
    }
  );

  it('when a subset is selected, should carry each guard path exactly once', async () => {
    // given: the shapes that ALSO reach a guard through a rule (a file-set change, a policy edit)
    // when:  the plan's path list is read
    // then:  the union dedupes, so a rule firing adds a REASON rather than a second copy of a path
    //        — a duplicated path would make vitest run the same suite twice
    const mod = await loadModule();
    const plan = mod.classifyChanged([{ status: 'M', path: mod.BASELINE_REL }], {
      baselineContentMoved: true
    });

    for (const suite of mod.GATE_GUARD_SUITES) {
      expect(plan.paths.filter((path) => path === suite).length, `${suite} duplication`).toBe(1);
    }
  });

  it('when the diff maps to nothing, should still be the whole suite and no guard subset', async () => {
    // given: the backstop the tier is an ADDITION to — an unmapped diff
    // when:  it is classified
    // then:  the answer is `full` with no paths: the union runs in `subset()` only, so it cannot
    //        degrade the fallback into a guard list (the defect this module's header records)
    const mod = await loadModule();
    const plan = mod.classifyChanged([{ status: 'A', path: 'README.md' }]);

    expect(plan.mode).toBe('full');
    expect(plan.code).toBe('unmapped');
    expect(plan.paths).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// behavior — the ROOT of `tests/unit/`, selected by rule and bounded to its own files
// ---------------------------------------------------------------------------

describe('Scenario: behavior — the root of the tier rides every subset verdict too', () => {
  it.each(SUBSET_SHAPES)(
    'when the diff is %s, should select every root `*.test.ts` the directory holds',
    async (_shape, entry) => {
      // given: one route to a subset verdict, and the root READ OFF THE DISK — an arm that typed
      //        these names would re-create the very list this rule removes
      // when:  the plan's selection is expanded the way the runner expands it
      // then:  every root test file is selected, including the ones no other route can reach
      const mod = await loadModule();
      const plan = mod.classifyChanged([entry], { baselineContentMoved: true });
      const selected = await expandPlan(plan);
      const expected = rootTierFiles();

      expect(expected.length, 'the root is the population this rule exists for').toBeGreaterThan(0);
      for (const file of expected) expect(selected, `${file} must be selected`).toContain(file);
    }
  );

  it('when the expansion is driven with a synthetic listing, should select a name no arm typed', async () => {
    // given: a listing from a FUTURE slice — a name this repository does not hold, a directory, and
    //        a nested path. No file is written: the listing crosses in as an ARGUMENT
    // when:  the shipped expansion is driven with it
    // then:  the unknown name IS selected, because the rule is about the shape of a directory and
    //        not a list of names — this is the arm that tells G1's "by rule" from (a)'s "by name",
    //        since the three names on disk today would satisfy either
    const mod = await loadModule();
    const root = await loadRootTier();
    const plan = mod.classifyChanged([{ status: 'M', path: 'src/cli/x.ts' }], {
      baselineContentMoved: true
    });
    const selected = root.expandRootTier(plan.paths, [
      'zz-guard-added-in-a-future-slice.test.ts',
      'services',
      'sub/nested.test.ts'
    ]);

    expect(selected).toContain('tests/unit/zz-guard-added-in-a-future-slice.test.ts');
    expect(selected).not.toContain('tests/unit/services');
    expect(selected).not.toContain('tests/unit/sub/nested.test.ts');
  });

  it('when the root is expanded, should contribute its own files and nothing wider', async () => {
    // given: the bound, MEASURED rather than felt — `tests/unit/` is a SUBSTRING of all 494 test
    //        files under it, so an expansion that yielded the bare directory would run the whole
    //        unit suite on every push: the subset mechanism deleting itself
    // when:  the shipped plan's selection is expanded against the real listing
    // then:  the root contributes EXACTLY the root's own `*.test.ts` files — no more and no fewer —
    //        and no entry is the bare `tests/unit` or `tests/unit/`
    const mod = await loadModule();
    const plan = mod.classifyChanged([{ status: 'M', path: 'src/cli/x.ts' }], {
      baselineContentMoved: true
    });
    const selected = await expandPlan(plan);
    const rootPart = selected.filter((path) => /^tests\/unit\/[^/]+\.test\.ts$/.test(path));

    expect([...rootPart].sort()).toEqual([...rootTierFiles()].sort());
    expect(selected).not.toContain('tests/unit');
    expect(selected).not.toContain('tests/unit/');
  });

  it('when a selector no rule recognizes reaches the expansion, should refuse loudly', async () => {
    // given: the fail-CLOSED direction R7 asks about — a ROOT-LEVEL pattern this rule does not know
    // when:  the expansion is driven with it
    // then:  it THROWS instead of passing the selector through: passed through, the runner's
    //        `existsSync` filter would drop it and the run would stay green with a guard missing —
    //        the silent-loss class this whole slice exists to close
    const root = await loadRootTier();

    expect(() => root.expandRootTier(['tests/unit/*.spec.ts'], [])).toThrow(/no rule/);
  });

  it('when a REAL path contains a `*`, should pass it through rather than block the push', async () => {
    // given: `*` is a legal POSIX FILE NAME byte, and `test-changed-classify.mjs` copies a diff's
    //        paths verbatim into `paths` — so a review that found this shape refusing the push was
    //        finding an availability regression, not a guard
    // when:  such a path reaches the expansion
    // then:  it is passed through UNCHANGED, exactly like any other entry: the refuse above is the
    //        CONTRACT (`===` the declared selector, or a root-level pattern), not a character class
    const root = await loadRootTier();
    const real = ['tests/unit/scripts/wild*card.test.ts', 'tests/unit/wild*card.test.ts'];
    const selected = root.expandRootTier(real, ['a.test.ts']);

    expect(selected).toContain(real[0]);
    expect(selected).toContain(real[1]);
  });
});

// ---------------------------------------------------------------------------
// integration — the tier is bound to the tree, and the arms above can go red
// ---------------------------------------------------------------------------

/** The union's ROOT member, spelled as source — the token the root plant removes. */
const ROOT_TIER_ANCHOR = '[...GATE_GUARD_SUITES, ROOT_TIER_SELECTOR]';

/**
 * The shipped classifier's bytes with the root's union member deleted, imported from scratch. It
 * THROWS when the anchor is gone, so a refactor cannot silently disarm the plant and stay green.
 */
async function loadPlantedRootTier(): Promise<ClassifyModule> {
  const source = readFileSync(join(REPO_ROOT, MODULE_REL), 'utf8');
  expect(source, `${MODULE_REL} no longer carries the root's union member`).toContain(
    ROOT_TIER_ANCHOR
  );
  const planted = source.replace(ROOT_TIER_ANCHOR, '[...GATE_GUARD_SUITES]');
  expect(planted, 'the injection must really change the module').not.toBe(source);
  const target = join(mkdtempSync(join(SCRATCH, 'planted-root-')), 'test-changed-classify.mjs');
  writeFileSync(target, planted, 'utf8');
  return (await import(pathToFileURL(target).href)) as ClassifyModule;
}

/** The union's expression in `subset()`, spelled as source — the token the plant removes. */
const UNION_ANCHOR = '[...new Set([...paths, ...TIER])]';

/**
 * The shipped module's bytes with the union deleted, imported from scratch. It THROWS when the
 * anchor is gone, so a refactor cannot silently disarm the plant and leave its arm green.
 */
async function loadPlantedUnion(): Promise<ClassifyModule> {
  const source = readFileSync(join(REPO_ROOT, MODULE_REL), 'utf8');
  expect(source, `${MODULE_REL} no longer carries the tier union`).toContain(UNION_ANCHOR);
  const planted = source.replace(UNION_ANCHOR, 'paths');
  expect(planted, 'the injection must really change the module').not.toBe(source);
  const target = join(mkdtempSync(join(SCRATCH, 'planted-union-')), 'test-changed-classify.mjs');
  writeFileSync(target, planted, 'utf8');
  return (await import(pathToFileURL(target).href)) as ClassifyModule;
}

describe('Scenario: integration — the union is what selects the tier, and removing it reddens the arms', () => {
  it('when the union is planted away, should stop selecting either guard directory', async () => {
    // given: the control — the shipped module carrying both directories on a content-only diff
    // when:  the same diff is classified by a copy with the union removed
    // then:  both guard paths are gone, so the arms above are falsifiable rather than vacuous
    const real = await loadModule();
    const shape = SUBSET_SHAPES[0]?.[1] as Entry;
    expect(
      real.classifyChanged([shape], { baselineContentMoved: true }).paths,
      'control: the shipped module carries the tier'
    ).toContain(real.STANDARDS_GUARD_PATH);

    const planted = await loadPlantedUnion();
    const plan = planted.classifyChanged([shape], { baselineContentMoved: true });

    expect(plan.mode, 'the union is not what decides `mode`').toBe('subset');
    expect(plan.paths, 'without the union the content-only route reaches no guard').not.toContain(
      planted.STANDARDS_GUARD_PATH
    );
    expect(plan.paths).not.toContain(planted.LINT_GUARD_PATH);
  });

  it('when the union is planted away, should redden every union-only route rather than the first', async () => {
    // given: the same plant, asked about both routes where no rule adds a guard
    // when:  each shape is classified by the planted copy
    // then:  neither route reaches a guard directory, so the arms above rest on the union and not
    //        on a rule that happens to fire for one of the rows
    const planted = await loadPlantedUnion();
    for (const [shape, entry] of UNION_ONLY_ROWS) {
      const plan = planted.classifyChanged([entry], { baselineContentMoved: true });
      expect(plan.paths, `${shape} must depend on the union`).not.toContain(
        planted.STANDARDS_GUARD_PATH
      );
      expect(plan.paths, `${shape} must not reach the lint guard either`).not.toContain(
        planted.LINT_GUARD_PATH
      );
    }
  });

  it('when the ROOT member is planted away, should stop selecting any root file', async () => {
    // given: the CONTROL first — the shipped module, asked about the diff shape s10 shipped
    // when:  the same diff is classified by a copy with the root's member removed from the union
    // then:  no root file is selected, so the arms above rest on the mechanism rather than on the
    //        three names happening to be there. The control matters: without it the plant's silence
    //        is indistinguishable from an arm that had no subject in the first place
    const real = await loadModule();
    const s10 = { status: 'A', path: 'src/services/distribution/unflagged-spawn.ts' };
    expect(
      real.classifyChanged([s10], { baselineContentMoved: true }).paths,
      'control: the shipped module carries the root selector'
    ).toContain(real.ROOT_TIER_SELECTOR);

    const planted = await loadPlantedRootTier();
    const plan = planted.classifyChanged([s10], { baselineContentMoved: true });
    const selected = await expandPlan(plan);

    expect(plan.mode, 'the root member is not what decides `mode`').toBe('subset');
    for (const file of rootTierFiles()) {
      expect(selected, `${file} must be gone once the root member is planted away`).not.toContain(
        file
      );
    }
  });

  it('when s10`s own diff shape is replayed, should reach the guard that exists to catch it', async () => {
    // given: s10's shape — a diff that ADDS a file in a mapped area; the guard that judges it
    //        (`spawn-windows-hide-guard`) walks the whole tree from the ROOT of `tests/unit/`
    // when:  the shipped plan is expanded, and the pre-fix classification is expanded alongside it
    // then:  the shipped selection contains that guard and the pre-fix one contains nothing at all
    //        from the root: the defect reproduces as a red arm, which is why this slice exists.
    //        The guard's NAME is typed here on purpose — this arm is about one named guard, while
    //        the coverage arms above read the root off the disk
    const s10 = { status: 'A', path: 'src/services/distribution/unflagged-spawn.ts' };
    const guard = 'tests/unit/spawn-windows-hide-guard.test.ts';
    const real = await loadModule();
    const shipped = await expandPlan(real.classifyChanged([s10], { baselineContentMoved: true }));
    expect(shipped, 'the spawn ratchet lives at the root and must be selected').toContain(guard);

    const planted = await loadPlantedRootTier();
    const prefixed = await expandPlan(
      planted.classifyChanged([s10], { baselineContentMoved: true })
    );
    expect(prefixed, 'pre-fix, the ratchet never runs for this diff').not.toContain(guard);
  });
});
