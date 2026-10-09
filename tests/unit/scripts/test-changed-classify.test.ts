/**
 * tests/unit/scripts/test-changed-classify.test.ts
 *
 * rid `2026-10-10-gate-classifier-backstop-repair`. The push gate's leg 2
 * (`.husky/pre-push` → `pnpm test:changed` → `scripts/test-changed.mjs`) classifies the diff,
 * and the classification lives in `scripts/test-changed-classify.mjs` because the runner runs
 * its whole flow at import, so no arm could read a rule out of it.
 *
 * WHAT THIS FILE EXISTS TO KEEP TRUE — the repair's blocking defect. Population guards used
 * to be unioned into the MAPPING, which made `picked.size > 0` for any A/D/R/C and killed the
 * unmapped→full-suite backstop: `A README.md`, `A .github/workflows/x.yml`, `A .husky/<hook>`
 * and `D docs/old.md` each selected 13 guard files instead of the whole suite, while five test
 * files read `.github/`. The `unmapped` arms below are that table, as arms; the backstop plant
 * proves they can go red.
 *
 * The module is loaded through `pathToFileURL` + a local type, the idiom
 * `tests/unit/scripts/test-changed-git-env.test.ts` uses for its sibling `scripts/*.mjs` (they
 * carry no `.d.mts`, and the point of the module is that it is importable at all).
 *
 * Dimensions: `render` is omitted — the classifier renders nothing (its verdict is an object,
 * and its human-facing rendering is the runner's stderr, asserted under `a11y`).
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { createScratchGitRepo, type ScratchGitRepo } from '../_setup/scratch-git-repo.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import {
  FILE_SIZE_SCOPE_DIRS,
  FILE_SIZE_SCOPE_EXTENSIONS
} from '../../../src/services/scan/file-size-policy.js';
import {
  BASELINE_PATH,
  REPO_ROOT as STANDARDS_SCAN_ROOT
} from '../standards/_file-size-cap-scan.js';

declareDimensions(
  'tests/unit/scripts/test-changed-classify.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason:
        'the classifier renders nothing — its verdict is an object, and its human-facing rendering is the runner stderr asserted under a11y'
    }
  ]
);

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const MODULE_REL = 'scripts/test-changed-classify.mjs';
const MODULE_URL = pathToFileURL(join(REPO_ROOT, MODULE_REL)).href;

type Entry = { status?: string; path?: string };

type Plan = {
  mode: 'full' | 'none' | 'subset';
  paths: string[];
  code: string;
  reasons: string[];
};

type ClassifyModule = {
  BASELINE_REL: string;
  CENSUS_POLICY_REL: string;
  FILE_SET_STATUSES: readonly string[];
  FULL_FALLBACK_EXEMPT: readonly string[];
  FULL_FALLBACK_TRIGGERS: readonly RegExp[];
  GATE_GUARD_SUITES: readonly string[];
  LINT_GUARD_PATH: string;
  STANDARDS_GUARD_PATH: string;
  classifyChanged(entries: readonly Entry[], options?: { baselineContentMoved?: boolean }): Plan;
  isPopulationChange(status: string): boolean;
  mergeEntries(entries: readonly Entry[]): Array<{ status: string; path: string }>;
  parseNameStatus(stdout: string): Array<{ status: string; path: string }>;
  withoutGeneratedAt(text: string): string;
};

async function loadModule(): Promise<ClassifyModule> {
  return (await import(MODULE_URL)) as ClassifyModule;
}

// ---------------------------------------------------------------------------
// the case tables. Paths are LITERALS on purpose — they are facts about the tree the gate
// classifies, not members of a constant this file could pin against itself. Everything the
// module OWNS (the guard paths, the status set, the trigger list) is read from the module
// instead, so a re-spelling of a rule cannot slip past an arm.
// ---------------------------------------------------------------------------

/**
 * §0's table, verbatim: diffs that reach NO mapping — no `src/<area>`, no changed test file.
 * Every one of them ran the FULL suite at HEAD, and every one of them selected 13 guard files
 * while the guards fed the mapping. The last row (`M`, non-exempt) is §0's own control: `M` is
 * deliberately not a file-set status, so it fell through even in the broken build.
 */
const UNMAPPED_DIFFS: ReadonlyArray<readonly [string, string]> = [
  ['A', 'README.md'],
  ['A', '.github/workflows/x.yml'],
  ['A', '.husky/pre-push'],
  ['A', 'docs/new.md'],
  ['D', 'docs/old.md'],
  ['D', 'tests/unit/x.test.ts'],
  ['M', 'README.md'],
  // The other paths §0 measured as outside the trigger list: neither a full-suite trigger nor
  // an area mapping, so each is exactly the shape the backstop exists for.
  ['A', '.npmrc'],
  ['M', 'eslint.config.js'],
  ['M', 'pnpm-workspace.yaml'],
  ['M', '.gitignore']
];

/** One representative path per full-suite trigger — seven triggers, seven rows. */
const TRIGGER_CASES: readonly string[] = [
  'package.json',
  'pnpm-lock.yaml',
  'vitest.config.ts',
  'tsconfig.json',
  'scripts/test-changed.mjs',
  '.claude/settings.json',
  '.peaks/standards/typescript/testing.md'
];

/** The statuses that change the file POPULATION — one arm each, as AC2 asks. */
const FILE_SET_CASES: ReadonlyArray<readonly [string, string]> = [
  ['A', 'src/services/distribution/added-runner.ts'],
  ['D', 'src/services/distribution/deleted-runner.ts'],
  ['R', 'src/services/distribution/renamed-runner.ts'],
  ['C', 'src/services/distribution/copied-runner.ts']
];

/** A gated path in a mapped area — the control the guards are an ADDITION to. */
const MAPPED_CONTENT_ONLY: Entry = {
  status: 'M',
  path: 'src/services/distribution/mcp-install-runner.ts'
};

// ---------------------------------------------------------------------------
// behavior — the backstop: an unmapped diff is the whole suite, guards or no guards
// ---------------------------------------------------------------------------

describe('Scenario: behavior — a diff that reaches no mapping runs the whole suite', () => {
  it.each(UNMAPPED_DIFFS)(
    'when the diff reports %s for %s, should run the whole suite rather than the guard subset',
    async (status, path) => {
      // given: a §0 row — a diff that maps to no test file and no src area
      // when:  the pre-push classifier classifies it
      // then:  mode is full by the unmapped reason, and no guard list stands in for the suite
      const mod = await loadModule();
      const plan = mod.classifyChanged([{ status, path }]);

      expect(plan.mode, `${status} ${path} must not degrade to a guard subset`).toBe('full');
      expect(plan.code).toBe('unmapped');
      expect(plan.paths).toEqual([]);
      for (const guard of mod.GATE_GUARD_SUITES) {
        expect(plan.paths, `${guard} must not be substituted for the whole suite`).not.toContain(
          guard
        );
      }
    }
  );

  it('when a content-only diff reaches a mapped area, should still be a subset', async () => {
    // given: the §0 control shape, which must not regress into the guard-subset defect either
    // when:  the classifier classifies it
    // then:  the area mapping is the answer and the whole-tree guards stay out
    const mod = await loadModule();
    const plan = mod.classifyChanged([MAPPED_CONTENT_ONLY]);

    expect(plan.mode).toBe('subset');
    expect(plan.code).toBe('subset');
    expect(plan.paths).toContain('tests/unit/services');
    expect(plan.paths).not.toContain(mod.STANDARDS_GUARD_PATH);
  });
});

// ---------------------------------------------------------------------------
// behavior — the guards are an ADDITION to a mapping (R1 / R2 / R3)
// ---------------------------------------------------------------------------

describe('Scenario: behavior — the population guards are added to a mapping', () => {
  it.each(FILE_SET_CASES)(
    'when the diff reports %s for a gated file, should select the population guards',
    async (status, path) => {
      // given: a diff entry whose STATUS changes the file population
      // when:  the pre-push classifier classifies it
      // then:  the whole-tree guards run alongside the area subset, never the whole suite
      const mod = await loadModule();
      const plan = mod.classifyChanged([{ status, path }]);

      expect(plan.mode, `${status} must not degrade to the whole suite`).toBe('subset');
      expect(plan.code).toBe('subset');
      expect(plan.paths, `${status} must reach the population guards`).toContain(
        mod.STANDARDS_GUARD_PATH
      );
      expect(plan.paths, `${status} must keep the area subset`).toContain('tests/unit/services');
    }
  );

  it('when the diff only changes file contents, should leave the population guards out', async () => {
    // given: a content-only change (M) to a gated file — the cheap path the gate protects
    // when:  the classifier classifies it
    // then:  the area subset runs and the whole-tree guards do NOT
    const mod = await loadModule();
    const plan = mod.classifyChanged([MAPPED_CONTENT_ONLY]);

    expect(plan.paths).not.toContain(mod.STANDARDS_GUARD_PATH);
    expect(plan.paths).toContain('tests/unit/services');
  });

  it('when the baseline artifact moves content, should run both of its guard suites', async () => {
    // given: the gate artifact with content actually moved, and its guard suites named as a rule
    // when:  the classifier classifies it
    // then:  every member of GATE_GUARD_SUITES runs, asserted by membership — so broadening the
    //        constant cannot redden the arm that protects the broadening
    const mod = await loadModule();
    const plan = mod.classifyChanged([{ status: 'M', path: mod.BASELINE_REL }]);

    expect(plan.mode).toBe('subset');
    expect(plan.code).toBe('r1-readers');
    expect(mod.GATE_GUARD_SUITES.length, 'one suite would mean R1 never covered the lint leg').toBe(
      2
    );
    for (const suite of mod.GATE_GUARD_SUITES) {
      expect(plan.paths, `${suite} guards the gate artifact and must run`).toContain(suite);
    }
  });

  it('when only the baseline generatedAt moved, should run zero tests and say so', async () => {
    // given: the runner's measurement — the artifact differs from its base blob by generatedAt alone
    // when:  the classifier is told so
    // then:  mode is none: 0 tests, said out loud, and no guard suite is paid for
    const mod = await loadModule();
    const plan = mod.classifyChanged([{ status: 'M', path: mod.BASELINE_REL }], {
      baselineContentMoved: false
    });

    expect(plan.mode).toBe('none');
    expect(plan.code).toBe('baseline-inert');
    expect(plan.paths).toEqual([]);
    expect(plan.reasons.join(' ')).toMatch(/generatedAt/);
  });

  it('when the option is omitted, should fail closed and run the guard suites', async () => {
    // given: a caller that read the artifact but never passed the fact across
    // when:  the classifier is invoked with no options at all
    // then:  the safe reading wins — content moved — so a content change cannot cost 0 tests
    const mod = await loadModule();
    const plan = mod.classifyChanged([{ status: 'M', path: mod.BASELINE_REL }]);

    expect(plan.mode, 'the omitted option must not select the 0-test verdict').toBe('subset');
    expect(plan.paths).toContain(mod.STANDARDS_GUARD_PATH);
  });

  it('when the artifact is inert or moved, should separate the 0-test path from the guard path', async () => {
    // given: the two readings of ONE artifact diff — the whole point of the runner's measurement
    // when:  both are classified
    // then:  an inert regeneration costs 0 tests and a content move costs the guard suites: the
    //        cheap path exists, and it cannot be reached by a content change
    const mod = await loadModule();
    const diff = [{ status: 'M', path: mod.BASELINE_REL }];
    const inert = mod.classifyChanged(diff, { baselineContentMoved: false });
    const moved = mod.classifyChanged(diff, { baselineContentMoved: true });

    expect(inert.mode).toBe('none');
    expect(inert.paths, 'an inert regeneration must select no test at all').toEqual([]);
    expect(moved.mode).toBe('subset');
    expect(moved.paths, 'a content move must run every gate guard suite').toEqual([
      ...mod.GATE_GUARD_SUITES
    ]);
  });

  it('when the file that defines the population changes, should run the population guards', async () => {
    // given: R3's shape — an M-status edit to the file that DEFINES the censused population
    // when:  the classifier classifies it
    // then:  the population guards run, and only that suite is added (R3 is not R1)
    const mod = await loadModule();
    const plan = mod.classifyChanged([{ status: 'M', path: mod.CENSUS_POLICY_REL }]);

    expect(plan.mode).toBe('subset');
    expect(plan.code).toBe('subset');
    expect(plan.paths).toContain(mod.STANDARDS_GUARD_PATH);
    expect(plan.paths, 'R3 adds the population guards only — it is not R1').not.toContain(
      mod.LINT_GUARD_PATH
    );
  });
});

// ---------------------------------------------------------------------------
// behavior — mergeEntries unions statuses (AC6)
// ---------------------------------------------------------------------------

describe('Scenario: behavior — one path, two statuses, one order-independent answer', () => {
  const TWO_STATUS = 'src/services/distribution/index-then-deleted.ts';

  it('when a path is both M and D, should read as a file-set change whatever the order', async () => {
    // given: the runner's `[...staged, ...unstaged]` feed — the same path with two statuses
    // when:  both orders are classified
    // then:  the verdicts are identical, and both fire the population guards
    const mod = await loadModule();
    const stagedFirst = mod.classifyChanged([
      { status: 'M', path: TWO_STATUS },
      { status: 'D', path: TWO_STATUS }
    ]);
    const unstagedFirst = mod.classifyChanged([
      { status: 'D', path: TWO_STATUS },
      { status: 'M', path: TWO_STATUS }
    ]);

    expect(stagedFirst).toEqual(unstagedFirst);
    for (const plan of [stagedFirst, unstagedFirst]) {
      expect(plan.paths, 'a D hiding behind an M would skip R2').toContain(
        mod.STANDARDS_GUARD_PATH
      );
    }
  });

  it('when every occurrence of a path is M, should keep it a content change', async () => {
    // given: the inverse of the union rule — nothing in the diff changes the file set
    // when:  mergeEntries and the classifier read it
    // then:  the status stays content-only, so the guards are not selected
    const mod = await loadModule();
    const merged = mod.mergeEntries([
      { status: 'M', path: TWO_STATUS },
      { status: 'M', path: TWO_STATUS }
    ]);

    expect(merged).toEqual([{ status: 'M', path: TWO_STATUS }]);
    expect(mod.classifyChanged([{ status: 'M', path: TWO_STATUS }]).paths).not.toContain(
      mod.STANDARDS_GUARD_PATH
    );
  });

  it('when an entry carries no readable status, should fail closed as a population change', async () => {
    // given: a status the parser could not read — the gate's unknown case
    // when:  it is classified
    // then:  it counts as a file-set change, so the guards run rather than being suppressed
    const mod = await loadModule();
    const plan = mod.classifyChanged([{ path: TWO_STATUS }]);

    expect(mod.isPopulationChange(''), 'an unreadable status must not read as content-only').toBe(
      true
    );
    expect(plan.paths).toContain(mod.STANDARDS_GUARD_PATH);
  });

  it('when the status letter is readable, should key the population change on the letter', async () => {
    // given: the set the module publishes, and the statuses outside it
    // when:  each is asked
    // then:  exactly the file-set statuses read as population changes
    const mod = await loadModule();
    for (const status of mod.FILE_SET_STATUSES) {
      expect(mod.isPopulationChange(status), `${status} changes the file set`).toBe(true);
    }
    for (const status of ['M', 'T']) {
      expect(mod.isPopulationChange(status), `${status} changes contents, not the file set`).toBe(
        false
      );
    }
  });
});

// ---------------------------------------------------------------------------
// behavior — parseNameStatus, including the two-path rename emission
// ---------------------------------------------------------------------------

describe('Scenario: behavior — the name-status parse emits both paths of a rename', () => {
  it('when git prints a rename line, should emit the old and the new path', async () => {
    // given: the real `git diff --name-status` line for a rename, and for a copy
    // when:  the parse reads them
    // then:  two entries share the status letter, so the OLD path still maps its area — the
    //        `--name-only` call this replaced printed only the new one and dropped that mapping
    const mod = await loadModule();
    const renamed = mod.parseNameStatus(
      'R100\ttests/unit/reporters/bdd-reporter.test.ts\tx.test.ts'
    );
    const copied = mod.parseNameStatus('C075\tsrc/alpha/old.ts\tsrc/beta/new.ts');

    expect(renamed).toEqual([
      { status: 'R', path: 'tests/unit/reporters/bdd-reporter.test.ts' },
      { status: 'R', path: 'x.test.ts' }
    ]);
    expect(copied).toEqual([
      { status: 'C', path: 'src/alpha/old.ts' },
      { status: 'C', path: 'src/beta/new.ts' }
    ]);
  });

  it('when a rename crosses areas, should classify both areas and the guards', async () => {
    // given: a rename whose two paths live under different src areas
    // when:  the classifier classifies the parsed entries
    // then:  both areas are selected, alongside the population guards
    const mod = await loadModule();
    const plan = mod.classifyChanged(
      mod.parseNameStatus('R100\tsrc/alpha/old.ts\tsrc/beta/new.ts')
    );

    expect(plan.mode).toBe('subset');
    expect(plan.paths).toContain('tests/unit/alpha');
    expect(plan.paths).toContain('tests/unit/beta');
    expect(plan.paths).toContain(mod.STANDARDS_GUARD_PATH);
  });

  it('when stdout carries no status column, should emit nothing', async () => {
    // given: an empty diff and a stray line that is not a name-status record
    // when:  the parse reads them
    // then:  no entry is invented, so the empty-diff verdict stays reachable
    const mod = await loadModule();

    expect(mod.parseNameStatus('')).toEqual([]);
    expect(mod.parseNameStatus('\n')).toEqual([]);
    expect(mod.classifyChanged(mod.parseNameStatus('')).code).toBe('empty-diff');
  });
});

// ---------------------------------------------------------------------------
// behavior — the full-suite triggers, and the increment they are keyed to
// ---------------------------------------------------------------------------

describe('Scenario: behavior — the trigger list and the generatedAt comparison', () => {
  it.each(TRIGGER_CASES)(
    'when %s changes, should decline to reason and run the whole suite',
    async (path) => {
      // given: a path from the full-fallback trigger list
      // when:  the classifier classifies it
      // then:  the verdict is the whole suite, coded 'trigger' (not the unmapped fallback)
      const mod = await loadModule();
      const plan = mod.classifyChanged([{ status: 'M', path }]);

      expect(plan.mode).toBe('full');
      expect(plan.code, 'a trigger arm asserting mode alone cannot tell the two fulls apart').toBe(
        'trigger'
      );
      expect(plan.paths).toEqual([]);
    }
  );

  it('when the diff is empty, should run the whole suite under its own code', async () => {
    // given: no changed paths at all
    // when:  the classifier classifies it
    // then:  an empty diff proves nothing, so the whole suite runs, coded 'empty-diff'
    const mod = await loadModule();
    const plan = mod.classifyChanged([]);

    expect(plan.mode).toBe('full');
    expect(plan.code).toBe('empty-diff');
  });

  it('when a path is outside the trigger list, should not be read as a full-suite trigger', async () => {
    // given: paths that share a PREFIX with a trigger but are not one
    // when:  the trigger list is asked about each
    // then:  none of them matches — the list is anchored, not a prefix rule
    const mod = await loadModule();
    for (const path of [
      'src/services/x.ts',
      'tests/unit/services/x.test.ts',
      '.peaksish/x.md',
      'scripts.mjs'
    ]) {
      expect(
        mod.FULL_FALLBACK_TRIGGERS.some((re) => re.test(path)),
        `${path} must not be a full-suite trigger`
      ).toBe(false);
    }
  });

  it('when a regeneration moves only generatedAt, should compare as unchanged', async () => {
    // given: the artifact body before and after a no-op regeneration — one line differs
    // when:  both are read through the comparison the runner uses
    // then:  they are equal, and a real content move is not
    const mod = await loadModule();
    const before = '{\n  "generatedAt": "2026-10-09T14:04:05.236Z",\n  "files": 659\n}\n';
    const after = '{\n  "generatedAt": "2026-10-09T17:23:39.114Z",\n  "files": 659\n}\n';
    const moved = '{\n  "generatedAt": "2026-10-09T17:23:39.114Z",\n  "files": 657\n}\n';

    expect(mod.withoutGeneratedAt(before)).toBe(mod.withoutGeneratedAt(after));
    expect(mod.withoutGeneratedAt(before), 'a real content move must be visible').not.toBe(
      mod.withoutGeneratedAt(moved)
    );
    expect(mod.withoutGeneratedAt(before), 'autocrlf must not read as content').toBe(
      mod.withoutGeneratedAt(before.replace(/\n/g, '\r\n'))
    );
  });

  it('when every verdict is reached, should carry a machine-readable code', async () => {
    // given: one diff per code the classifier can return, including the 0-test path
    // when:  each is classified
    // then:  each verdict names its own code and narrates a reason, so no arm can prove a
    //        verdict by `mode` alone and every branch (none included) is reachable
    const mod = await loadModule();
    const cases: ReadonlyArray<readonly [string, Plan]> = [
      ['empty-diff', mod.classifyChanged([])],
      ['trigger', mod.classifyChanged([{ status: 'M', path: 'package.json' }])],
      ['unmapped', mod.classifyChanged([{ status: 'M', path: 'README.md' }])],
      [
        'baseline-inert',
        mod.classifyChanged([{ status: 'M', path: mod.BASELINE_REL }], {
          baselineContentMoved: false
        })
      ],
      ['r1-readers', mod.classifyChanged([{ status: 'M', path: mod.BASELINE_REL }])],
      ['subset', mod.classifyChanged([MAPPED_CONTENT_ONLY])]
    ];

    for (const [code, plan] of cases) {
      expect(plan.code, `${code} is not the verdict's code`).toBe(code);
      expect(plan.reasons.length, `${code} carried no reason to print`).toBeGreaterThan(0);
    }
  });

  it('when the module declares its policy lists, should carry the seven triggers and one exemption', async () => {
    // given: the policy lists every arm above is keyed to
    // when:  the module is read
    // then:  the counts and the exemption are exactly what the gate was measured against
    const mod = await loadModule();

    expect(mod.FULL_FALLBACK_TRIGGERS.length, 'a trigger was added or dropped').toBe(7);
    expect([...mod.FULL_FALLBACK_EXEMPT]).toEqual([mod.BASELINE_REL]);
    expect([...mod.FILE_SET_STATUSES]).toEqual(['A', 'D', 'R', 'C']);
    expect(mod.STANDARDS_GUARD_PATH).toBe('tests/unit/standards/');
    expect(mod.LINT_GUARD_PATH).toBe('tests/unit/lint/');
  });
});

// ---------------------------------------------------------------------------
// integration — the rules are bound to the tree they classify, and they can go red
// ---------------------------------------------------------------------------

const SCRATCH = mkdtempSync(join(tmpdir(), 'peaks-classify-'));

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

/** R1's guard condition, as the plant anchor spells it. */
const R1_ANCHOR = 'if (baselineTouched && baselineContentMoved) {';
/** R3's guard condition, likewise. */
const R3_ANCHOR = 'if (entries.some((entry) => entry.path === CENSUS_POLICY_REL)) {';
/** R2's guard condition, likewise. */
const R2_ANCHOR = 'if (population.length > 0) {';
/** The backstop itself — planting the pre-repair structure back in. */
const BACKSTOP_ANCHOR = 'if (mapped.size === 0) {';

/**
 * The shipped module's bytes with one anchor rewritten, imported from scratch. It THROWS when
 * the anchor is gone, so a refactor cannot silently disarm a plant and leave its arm green.
 */
async function loadPlanted(anchor: string, replacement = 'if (false) {'): Promise<ClassifyModule> {
  const source = readFileSync(join(REPO_ROOT, MODULE_REL), 'utf8');
  expect(source, `${MODULE_REL} no longer carries ${anchor}`).toContain(anchor);
  const root = mkdtempSync(join(SCRATCH, 'planted-'));
  const target = join(root, 'test-changed-classify.mjs');
  const planted = source.replace(anchor, replacement);
  expect(planted, 'the injection must really change the module').not.toBe(source);
  writeFileSync(target, planted, 'utf8');
  return (await import(pathToFileURL(target).href)) as ClassifyModule;
}

describe('Scenario: integration — the rules are bound to the tree they classify', () => {
  it('when the classifier exempts a path, should be the baseline the standards scan reads', async () => {
    // given: the reader the 2026-09-23 search missed — BASELINE_PATH in the scan library
    // when:  it is compared with the path the exemption names
    // then:  they are the same file, and that file is on disk
    const mod = await loadModule();

    expect(BASELINE_PATH, 'the exemption must name the artifact a test actually reads').toBe(
      join(STANDARDS_SCAN_ROOT, mod.BASELINE_REL)
    );
    expect(existsSync(BASELINE_PATH), 'the reader reads a published artifact').toBe(true);
  });

  it('when R1 names its guard suites, should name directories that exist', async () => {
    // given: GATE_GUARD_SUITES, stated as the boundary "these suites guard the artifact"
    // when:  each member is looked for on disk
    // then:  every one resolves, so adding a suite elsewhere is a red arm rather than a
    //        silently-unrun guard, and the list is exactly the two measured suites
    const mod = await loadModule();

    expect([...mod.GATE_GUARD_SUITES]).toEqual([mod.STANDARDS_GUARD_PATH, mod.LINT_GUARD_PATH]);
    for (const suite of mod.GATE_GUARD_SUITES) {
      expect(existsSync(join(REPO_ROOT, suite)), `${suite} does not exist`).toBe(true);
    }
  });

  it('when R3 names the census policy, should name the file that defines the population', async () => {
    // given: CENSUS_POLICY_REL, which R3 relies on being the policy's one source of truth
    // when:  the path is resolved and the module's own exports are read
    // then:  the file is there — a MOVE is a red arm, not silent drift — and it really is the
    //        file holding the scope dirs and extensions the census consumes
    const mod = await loadModule();
    const policyPath = join(REPO_ROOT, mod.CENSUS_POLICY_REL);

    expect(existsSync(policyPath), `${mod.CENSUS_POLICY_REL} moved`).toBe(true);
    expect(FILE_SIZE_SCOPE_DIRS.length, 'the modules must be the same file').toBeGreaterThan(0);
    expect(FILE_SIZE_SCOPE_EXTENSIONS.length, 'the modules must be the same file').toBeGreaterThan(
      0
    );
  });

  it('when the baseline rule is planted away, should stop selecting the gate guard suites', async () => {
    // given: R1's guard removed from a copy of the module
    // when:  a content-moved baseline diff is classified by the planted copy
    // then:  the guard suites are gone — the negation of the R1 arm, which is why it can fail
    const real = await loadModule();
    expect(
      real.classifyChanged([{ status: 'M', path: real.BASELINE_REL }]).paths,
      'control'
    ).toEqual([...real.GATE_GUARD_SUITES]);

    const planted = await loadPlanted(R1_ANCHOR);
    const plan = planted.classifyChanged([{ status: 'M', path: planted.BASELINE_REL }]);

    expect(plan.paths, 'without R1 nothing reaches the artifact guard suites').toEqual([]);
  });

  it('when the file-set rule is planted away, should stop selecting the population guards', async () => {
    // given: R2's guard removed from a copy of the module
    // when:  an added-file diff is classified by the planted copy
    // then:  the guards are gone — the negation of the AC1/AC2 arms
    const real = await loadModule();
    expect(
      real.classifyChanged([{ status: 'A', path: 'src/services/distribution/added-runner.ts' }])
        .paths,
      'control'
    ).toContain(real.STANDARDS_GUARD_PATH);

    const planted = await loadPlanted(R2_ANCHOR);
    const plan = planted.classifyChanged([
      { status: 'A', path: 'src/services/distribution/added-runner.ts' }
    ]);

    expect(plan.paths).not.toContain(planted.STANDARDS_GUARD_PATH);
    expect(plan.paths).toContain('tests/unit/services');
  });

  it('when the census-policy rule is planted away, should stop selecting the population guards', async () => {
    // given: R3's guard removed from a copy of the module
    // when:  an M-only diff to the policy file is classified by the planted copy
    // then:  only the area subset remains — the negation of the R3 arm
    const real = await loadModule();
    expect(
      real.classifyChanged([{ status: 'M', path: real.CENSUS_POLICY_REL }]).paths,
      'control'
    ).toContain(real.STANDARDS_GUARD_PATH);

    const planted = await loadPlanted(R3_ANCHOR);
    const plan = planted.classifyChanged([{ status: 'M', path: planted.CENSUS_POLICY_REL }]);

    expect(plan.paths).not.toContain(planted.STANDARDS_GUARD_PATH);
    expect(plan.paths).toContain('tests/unit/services');
  });

  it('when the guards feed the mapping again, should show the backstop arms can go red', async () => {
    // given: the pre-repair structure planted back — the guards participate in the net
    // when:  a §0 row is classified by the planted copy
    // then:  the whole suite is replaced by the guard list, i.e. the §0 defect reproduces and
    //        every `unmapped` arm above is falsifiable rather than vacuous
    const real = await loadModule();
    expect(real.classifyChanged([{ status: 'A', path: 'README.md' }]).mode, 'control').toBe('full');

    const planted = await loadPlanted(
      BACKSTOP_ANCHOR,
      'if (mapped.size === 0 && guards.length === 0) {'
    );
    const plan = planted.classifyChanged([{ status: 'A', path: 'README.md' }]);

    expect(plan.mode, 'with the guards in the net an unmapped diff is no longer full').toBe(
      'subset'
    );
    expect(plan.paths).toEqual([planted.STANDARDS_GUARD_PATH]);
  });
});

// ---------------------------------------------------------------------------
// integration — the runner measures the artifact against BOTH objects its diff reads
//
// WHY THE RUNNER IS DRIVEN END TO END. `baselineContentMoved` is the one rule that lives in
// `scripts/test-changed.mjs`, and that file runs its whole flow at import, so no arm can call it
// (the same reason this classifier module exists at all). QA reproduced its incoherence by hand
// (rid `2026-10-10-gate-classifier-baseline-coverage`, F1): stage a moved artifact, revert the
// worktree file, and the gate printed `baseline-inert` — 0 test files, exit 0, vitest never
// spawned. The invariant is about the runner's two readings of ONE artifact, so the arm builds a
// real repository, puts it in exactly that state, and runs the gate's own script against it. The
// classifier's arms cannot see it — the fact crosses the boundary as an option (module header) —
// and a source-text pin would neither have caught the defect (M1 of the previous round) nor catch
// its return. The §4 pair of request 002 is run here end to end as well, which is the one thing
// that round recorded as unverified ("I could not run (a) end-to-end").
// ---------------------------------------------------------------------------

/** What the fixture's vitest entry prints, so "a suite process ran" is observable. */
const STUB_VITEST_MARKER = '[fixture-vitest] spawned';
/** The runner spawns a LOCAL vitest entry; this stub makes that spawn cheap and visible. */
const STUB_VITEST = `process.stderr.write('${STUB_VITEST_MARKER} ' + process.argv.slice(2).join(' ') + '\\n');\nprocess.exit(0);\n`;

/** The gate's own scripts — the runner and its classifier resolve them relative to themselves. */
const GATE_RUNNER = 'test-changed.mjs';
const GATE_SCRIPTS = [GATE_RUNNER, 'test-changed-classify.mjs', 'git-hook-env.mjs'] as const;
const HOOK_ENV_URL = pathToFileURL(join(REPO_ROOT, 'scripts', 'git-hook-env.mjs')).href;

/** A published-looking artifact body: the line a no-op regeneration rewrites, and one it does not. */
function artifactText(generatedAt: string, measuredFiles: number): string {
  return `{\n  "version": 3,\n  "generatedAt": "${generatedAt}",\n  "shadow": { "measuredFiles": ${measuredFiles} }\n}\n`;
}

/** The artifact committed at the fixture's base, plus the two variants an arm stages. */
const ARTIFACT_AT_BASE = artifactText('2026-10-09T17:48:26.698Z', 659);
const ARTIFACT_STAMP_ONLY = artifactText('2026-10-09T18:23:10.021Z', 659);
const ARTIFACT_CONTENT_MOVED = artifactText('2026-10-09T18:23:10.021Z', 657);

type GateFixture = {
  repo: ScratchGitRepo;
  env: NodeJS.ProcessEnv;
  artifactRel: string;
  guardSuites: readonly string[];
};

/**
 * git's hook context is what makes a fixture commit land in the HOST repository, so the fixture
 * uses the gate's own scrubber rather than a second copy of the variable list.
 */
async function scrubbedEnv(): Promise<NodeJS.ProcessEnv> {
  const mod = (await import(HOOK_ENV_URL)) as {
    scrubGitHookEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
  };
  return mod.scrubGitHookEnv({ ...process.env });
}

/** Write the artifact at its published path, creating the directory it lives in. */
function writeArtifact(root: string, artifactRel: string, text: string): void {
  mkdirSync(dirname(join(root, artifactRel)), { recursive: true });
  writeFileSync(join(root, artifactRel), text, 'utf8');
}

/** One git command in the fixture. A refusal THROWS — a fixture that did not run is never a pass. */
function gitIn(cwd: string, args: readonly string[], env: NodeJS.ProcessEnv): void {
  const res = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env, windowsHide: true });
  if (res.error !== undefined && res.error !== null) {
    throw new Error(
      `gate fixture: \`git ${args.join(' ')}\` did not run in ${cwd}: ${res.error.message}`
    );
  }
  if (res.status !== 0) {
    throw new Error(
      `gate fixture: \`git ${args.join(' ')}\` failed in ${cwd}: ${(res.stderr ?? '').trim()}`
    );
  }
}

/** A repository holding the gate's own scripts, with the artifact committed at its base content. */
async function buildGateFixture(): Promise<GateFixture> {
  const mod = await loadModule();
  const env = await scrubbedEnv();
  const repo = createScratchGitRepo('peaks-gate-fixture-');
  for (const name of GATE_SCRIPTS) {
    mkdirSync(join(repo.path, 'scripts'), { recursive: true });
    writeFileSync(
      join(repo.path, 'scripts', name),
      readFileSync(join(REPO_ROOT, 'scripts', name), 'utf8'),
      'utf8'
    );
  }
  // R1's two suites, on disk, so the guard subset resolves instead of falling back to the whole
  // suite (existence is the runner's own fs filter, not a classification rule).
  for (const suite of mod.GATE_GUARD_SUITES) mkdirSync(join(repo.path, suite), { recursive: true });
  mkdirSync(join(repo.path, 'node_modules', 'vitest'), { recursive: true });
  writeFileSync(join(repo.path, 'node_modules', 'vitest', 'vitest.mjs'), STUB_VITEST, 'utf8');

  writeArtifact(repo.path, mod.BASELINE_REL, ARTIFACT_AT_BASE);
  gitIn(repo.path, ['add', mod.BASELINE_REL], env);
  gitIn(repo.path, ['commit', '--quiet', '-m', 'gate artifact at its base content'], env);
  return { repo, env, artifactRel: mod.BASELINE_REL, guardSuites: [...mod.GATE_GUARD_SUITES] };
}

let gateFixturePromise: Promise<GateFixture> | undefined;

/** The one fixture this section drives, built on first use (its cost is real process spawns). */
function gateFixture(): Promise<GateFixture> {
  gateFixturePromise ??= buildGateFixture();
  return gateFixturePromise;
}

/**
 * Put the fixture in the state an arm needs. The INDEX and the WORKTREE are named separately
 * because the whole point of this section is that those two objects can disagree.
 */
function stageArtifact(fixture: GateFixture, indexText: string, worktreeText: string): void {
  writeArtifact(fixture.repo.path, fixture.artifactRel, indexText);
  gitIn(fixture.repo.path, ['add', fixture.artifactRel], fixture.env);
  writeArtifact(fixture.repo.path, fixture.artifactRel, worktreeText);
}

/** Run the gate's own runner in the fixture; return its exit code and everything it printed. */
function runGate(fixture: GateFixture): { status: number | null; stderr: string } {
  const res = spawnSync(
    process.execPath,
    [join(fixture.repo.path, 'scripts', GATE_RUNNER), '--', 'HEAD'],
    {
      cwd: fixture.repo.path,
      env: fixture.env,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 120_000
    }
  );
  if (res.error !== undefined && res.error !== null) {
    throw new Error(`the gate runner did not run: ${res.error.message}`);
  }
  return { status: res.status, stderr: res.stderr ?? '' };
}

describe('Scenario: integration — the runner measures the artifact against both objects its diff reads', () => {
  afterAll(async () => {
    if (gateFixturePromise === undefined) return;
    (await gateFixturePromise).repo.dispose();
  });

  it(
    'when the artifact is untouched in the index and the worktree, should leave the diff empty',
    async () => {
      // given: A1's inverse — the artifact at its base content in BOTH objects, so it is not in the diff
      // when:  the gate's own runner classifies that diff
      // then:  the ordinary empty-diff fallback holds: the coherence change must not turn an
      //        untouched artifact into a guard-suite run
      const fixture = await gateFixture();
      stageArtifact(fixture, ARTIFACT_AT_BASE, ARTIFACT_AT_BASE);
      const { status, stderr } = runGate(fixture);

      expect(status, stderr).toBe(0);
      expect(stderr).toContain('verdict: empty-diff');
      expect(stderr, 'the whole suite is the unchanged answer here').toContain(STUB_VITEST_MARKER);
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'when only the generatedAt stamp moved, should select zero tests and start no suite',
    async () => {
      // given: the no-op regeneration the whole exemption exists for — index and worktree agree
      // when:  the gate's own runner classifies it
      // then:  0 test files, said out loud, and vitest is never spawned (request 003 A2)
      const fixture = await gateFixture();
      stageArtifact(fixture, ARTIFACT_STAMP_ONLY, ARTIFACT_STAMP_ONLY);
      const { status, stderr } = runGate(fixture);

      expect(status, stderr).toBe(0);
      expect(stderr).toContain('verdict: baseline-inert');
      expect(stderr).toContain('0 test files selected');
      expect(stderr, 'the 0-test path must not pay for a suite process').not.toContain(
        STUB_VITEST_MARKER
      );
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'when the artifact content moved in both the index and the worktree, should select the gate guard suites',
    async () => {
      // given: request 002 §4(b) — a real regeneration moved more than the stamp
      // when:  the gate's own runner classifies it
      // then:  R1's two guard suites are the selection, and the suite process is handed exactly them
      const fixture = await gateFixture();
      stageArtifact(fixture, ARTIFACT_CONTENT_MOVED, ARTIFACT_CONTENT_MOVED);
      const { status, stderr } = runGate(fixture);

      expect(status, stderr).toBe(0);
      expect(stderr).toContain('verdict: r1-readers');
      for (const suite of fixture.guardSuites) expect(stderr).toContain(`* ${suite}`);
      expect(stderr, 'vitest must be handed both suites').toContain(
        `${STUB_VITEST_MARKER} run ${fixture.guardSuites.join(' ')}`
      );
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'when a moved artifact is staged while the worktree holds the base content, should not read the diff as inert',
    async () => {
      // given: QA's reproduction — the index carries the move, the worktree was reverted to base
      // when:  the gate's own runner classifies that diff (`--cached` is what sees the change)
      // then:  the artifact IS in the diff, so the 0-test verdict is not available and the guard
      //        suites run. Measuring the worktree alone printed `baseline-inert`: 0 tests, exit 0,
      //        vitest never spawned (F1 of rid 2026-10-10-gate-classifier-baseline-coverage).
      const fixture = await gateFixture();
      stageArtifact(fixture, ARTIFACT_CONTENT_MOVED, ARTIFACT_AT_BASE);
      const { status, stderr } = runGate(fixture);

      expect(status, stderr).toBe(0);
      expect(stderr, `the staged move must be in the diff: ${stderr}`).toContain(
        `- M ${fixture.artifactRel}`
      );
      expect(
        stderr,
        'a staged move with a reverted worktree is not an inert artifact'
      ).not.toContain('verdict: baseline-inert');
      expect(stderr).toContain('verdict: r1-readers');
      expect(stderr, 'and a suite process really ran').toContain(STUB_VITEST_MARKER);
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );
});

// ---------------------------------------------------------------------------
// a11y — the reasons are the stderr narration the hook prints
// ---------------------------------------------------------------------------

describe('Scenario: a11y — every verdict carries the reason it will be printed with', () => {
  it('when the whole suite is chosen, should say so', async () => {
    // given: a diff the classifier declines to reason about
    // when:  its reasons are read
    // then:  they name the whole suite, so the hook's stderr explains the cost
    const mod = await loadModule();
    const plan = mod.classifyChanged([{ status: 'M', path: 'package.json' }]);

    expect(plan.reasons.length).toBeGreaterThan(0);
    expect(plan.reasons.join(' ')).toMatch(/whole suite/);
  });

  it('when a subset is chosen, should name the rule that selected each part', async () => {
    // given: a diff that reaches both the artifact rule and the file-set rule at once
    // when:  its reasons are read
    // then:  the artifact and the file-set change are each named, with the suites they reach
    const mod = await loadModule();
    const plan = mod.classifyChanged([
      { status: 'M', path: mod.BASELINE_REL },
      { status: 'A', path: 'src/services/distribution/added-runner.ts' }
    ]);
    const narrated = plan.reasons.join(' | ');

    expect(plan.reasons.length).toBeGreaterThan(1);
    expect(narrated).toContain(mod.BASELINE_REL);
    expect(narrated).toContain(mod.STANDARDS_GUARD_PATH);
    expect(narrated).toContain('file set changed');
  });

  it('when nothing maps, should say why the whole suite is the answer', async () => {
    // given: an unmapped diff — the §0 shape whose verdict the gate's operator will read
    // when:  its reasons are read
    // then:  the reason explains the fallback instead of printing an empty list
    const mod = await loadModule();
    const plan = mod.classifyChanged([{ status: 'A', path: 'docs/new.md' }]);

    expect(plan.code).toBe('unmapped');
    expect(plan.reasons.join(' ')).toMatch(/whole suite/);
  });

  it('when the zero-test verdict is reached, should say the artifact was inert', async () => {
    // given: the only 0-test path — the runner prints this and exits 0
    // when:  its reasons are read
    // then:  it names the artifact, so a 0-test green is never mistaken for a suite that ran
    const mod = await loadModule();
    const plan = mod.classifyChanged([{ status: 'M', path: mod.BASELINE_REL }], {
      baselineContentMoved: false
    });

    expect(plan.reasons.join(' ')).toContain(mod.BASELINE_REL);
    expect(plan.reasons.join(' ')).toMatch(/0 test files/);
  });
});
