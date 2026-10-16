/**
 * tests/unit/scripts/test-changed-guard-tier.test.ts
 *
 * THE TIER EVERY SUBSET CARRIES. `scripts/test-changed-classify.mjs` unions GATE_GUARD_SUITES into
 * every `subset` verdict, so a diff that only edits existing files reaches the two whole-tree
 * suites: their subject is the repository tree, and the area rule maps `src/<area>` to
 * `tests/unit/<area>`, so a scoped run cannot cover them by construction. A slice whose scoped run
 * misses them ships a red guard past every reviewer and QA.
 *
 * WHY THIS IS A SIBLING FILE rather than more arms in `test-changed-classify.test.ts`: that file is
 * over its own file-size cap, and the census counts raw lines, so one more arm there would move a
 * ratcheted total. The split is therefore a budget decision, stated rather than implied — the
 * classifier's arms stay where they were, and this rule owns a file with room.
 *
 * THE PLANT IS THE REQUIREMENT. An arm that reads a rule out of the module proves the rule is
 * present, not that the arm could fail. So `loadPlantedUnion` imports a copy of the module with the
 * union REMOVED and every arm above is re-asked against it; a guard that stays green when the union
 * is deleted is vacuous. The plant THROWS when its anchor is gone, so a refactor cannot silently
 * disarm it and leave the arm green.
 *
 * Dimensions: `render` is omitted (the classifier renders nothing — its verdict is an object and
 * the runner's narration is asserted in the sibling file) and `a11y` is omitted for the same
 * reason (no human-facing text is produced here).
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

type Entry = { status?: string; path?: string };
type Plan = { mode: 'full' | 'none' | 'subset'; paths: string[]; code: string; reasons: string[] };
type ClassifyModule = {
  BASELINE_REL: string;
  LINT_GUARD_PATH: string;
  STANDARDS_GUARD_PATH: string;
  GATE_GUARD_SUITES: readonly string[];
  classifyChanged(entries: readonly Entry[], options?: { baselineContentMoved?: boolean }): Plan;
};

const SCRATCH = mkdtempSync(join(tmpdir(), 'peaks-guard-tier-'));

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

async function loadModule(): Promise<ClassifyModule> {
  return (await import(MODULE_URL)) as ClassifyModule;
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
// integration — the tier is bound to the tree, and the arms above can go red
// ---------------------------------------------------------------------------

/** The union's expression in `subset()`, spelled as source — the token the plant removes. */
const UNION_ANCHOR = '[...new Set([...paths, ...GATE_GUARD_SUITES])]';

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
});
