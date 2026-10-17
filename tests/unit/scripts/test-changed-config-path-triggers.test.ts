/**
 * tests/unit/scripts/test-changed-config-path-triggers.test.ts
 *
 * The two CONFIG-PATH triggers — `.github/**` and `.husky/**` — and the one class of diff they
 * exist for. rid `2026-10-17-config-paths-reach-the-suite`.
 *
 * THE HOLE. Neither path was a trigger, so each ALONE reached the whole suite through the
 * `unmapped` backstop and looked safe. Adding ONE mapped path beside it made the verdict `subset`,
 * so a change to the gate was verified by a subset that skipped the tests guarding it: slice A's
 * own push touched `.husky/peaks-gate-pipeline.mjs` + `src/` + `tests/` and ran 318 files where the
 * full suite is 493. Over the last 200 commits, 26 diffs touch one of the two paths and **7** of
 * them were that composite shape (`git log -n200` re-derived 2026-10-17).
 *
 * WHY A SIBLING FILE AND NOT MORE ARMS IN `test-changed-classify.test.ts`. Not taste — the
 * `file-size-delta.ts` leg refuses GROWTH in a file already over its cap, and that file carries
 * 416 excess lines; the classifier it tests carries 66. A file UNDER its cap adds nothing to the
 * census, so the rule's narrative is paid for here, exactly as `test-changed-root-tier.mjs`
 * records for the classifier's own module.
 *
 * WHY EVERY ARM COMPARES TWO REAL MODULES RATHER THAN A TABLE. "Adding `/^\.github\//` only
 * affects diffs that contain `.github/`" is a claim about the RULE, and a table of expected
 * verdicts would restate the rule instead of running it. `withoutDotTriggers()` is the shipped
 * source with exactly those two lines deleted, so every arm below is `shipped` vs
 * `shipped-minus-the-rule` — and the composite arm is one a deletion makes FALSE.
 *
 * Dimensions: `render` is omitted — the classifier renders nothing, and its human-facing
 * rendering is the runner's stderr, asserted in `test-changed-classify.test.ts` under `a11y`.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/scripts/test-changed-config-path-triggers.test.ts',
  ['behavior', 'integration'],
  [
    {
      dim: 'a11y',
      reason:
        'the classifier prints nothing — its verdict is an object; the reason lines a hook prints are asserted under a11y in test-changed-classify.test.ts'
    },
    {
      dim: 'render',
      reason:
        'the classifier renders nothing — its verdict is an object, and the human-facing rendering is the runner stderr'
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
  FULL_FALLBACK_TRIGGERS: readonly RegExp[];
  classifyChanged(entries: readonly Entry[], options?: { baselineContentMoved?: boolean }): Plan;
};

async function loadModule(): Promise<ClassifyModule> {
  return (await import(MODULE_URL)) as ClassifyModule;
}

const SCRATCH = mkdtempSync(join(tmpdir(), 'peaks-dottriggers-'));

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

/**
 * The two lines this slice added, exactly as the shipped source spells them. The plant THROWS
 * when the anchor is gone, so a refactor cannot silently disarm these arms and leave them green.
 */
const DOT_TRIGGERS_ANCHOR = '  /^\\.github\\//,\n  /^\\.husky\\//\n';

/** The shipped module's bytes minus the two new entries — the before-state, importable. */
async function loadWithoutDotTriggers(): Promise<ClassifyModule> {
  const source = readFileSync(join(REPO_ROOT, MODULE_REL), 'utf8');
  expect(source, `${MODULE_REL} no longer carries the two entries`).toContain(DOT_TRIGGERS_ANCHOR);
  const target = join(mkdtempSync(join(SCRATCH, 'planted-')), 'test-changed-classify.mjs');
  const planted = source.replace(DOT_TRIGGERS_ANCHOR, '');
  expect(planted, 'the injection must really change the module').not.toBe(source);
  writeFileSync(target, planted, 'utf8');
  return (await import(pathToFileURL(target).href)) as ClassifyModule;
}

let before: Promise<ClassifyModule> | undefined;

/** Built once: the import is real, and one temp module is enough for every arm below. */
function withoutDotTriggers(): Promise<ClassifyModule> {
  before ??= loadWithoutDotTriggers();
  return before;
}

/** What the gate DOES with a verdict: the mode, and the selection it hands vitest. */
const selectionOf = (plan: Plan): string => JSON.stringify({ mode: plan.mode, paths: plan.paths });

/**
 * The diffs the two entries must change: a dot path PLUS a path that maps to a test. The third
 * column is what the mapping selected in the before-state — a directory for a `src/<area>` path,
 * the file itself for a changed test — which is what made the composite diff look classified.
 */
const COMPOSITE_DOT_DIFFS: ReadonlyArray<readonly [string, string[], string]> = [
  ['.github + src', ['src/services/demo/x.ts', '.github/workflows/ci.yml'], 'tests/unit/services'],
  ['.husky + src', ['src/services/demo/x.ts', '.husky/pre-push'], 'tests/unit/services'],
  [
    '.github + a tests area',
    ['tests/unit/services/x.test.ts', '.github/workflows/ci.yml'],
    'tests/unit/services/x.test.ts'
  ],
  [
    '.husky + a tests area',
    ['tests/unit/services/x.test.ts', '.husky/pre-push'],
    'tests/unit/services/x.test.ts'
  ]
];

/** The dot-path diffs the entries must NOT change: these reached the whole suite already. */
const DOT_ONLY_ALREADY_FULL: ReadonlyArray<readonly [string, string[]]> = [
  ['.github alone', ['.github/workflows/ci.yml']],
  ['.husky alone', ['.husky/pre-push']],
  ['.github + docs', ['docs/guide.md', '.github/workflows/ci.yml']],
  ['.github + package.json', ['package.json', '.github/workflows/ci.yml']],
  ['.github + an exempt path', ['.peaks/lint/gate-baseline.json', '.github/workflows/ci.yml']]
];

/** Diffs carrying NEITHER path — the group whose verdicts must not move by a single byte. */
const NEITHER_DOT_PATH: ReadonlyArray<readonly [string, string[]]> = [
  ['a src area', ['src/services/demo/x.ts']],
  ['a tests area', ['tests/unit/services/x.test.ts']],
  ['docs', ['docs/guide.md']],
  ['README', ['README.md']],
  ['a full-suite trigger', ['package.json']],
  ['.claude', ['.claude/settings.json']],
  ['.peaks', ['.peaks/standards/x.md']],
  ['.changeset', ['.changeset/config.json']],
  ['the baseline exemption', ['.peaks/lint/gate-baseline.json']],
  ['src + a tests area', ['src/services/demo/x.ts', 'tests/unit/services/x.test.ts']],
  ['a file-set change', ['src/services/distribution/added-runner.ts']],
  ['an empty diff', []]
];

/** One representative path per trigger, all nine — the table the sibling file no longer holds. */
const ALL_TRIGGERS: ReadonlyArray<readonly [string, string]> = [
  ['package.json', 'package.json'],
  ['pnpm-lock.yaml', 'pnpm-lock.yaml'],
  ['vitest.config.ts', 'vitest.config.ts'],
  ['tsconfig.json', 'tsconfig.json'],
  ['scripts/', 'scripts/test-changed.mjs'],
  ['.claude/', '.claude/settings.json'],
  ['.peaks/', '.peaks/standards/typescript/testing.md'],
  ['.github/', '.github/workflows/ci.yml'],
  ['.husky/', '.husky/pre-push']
];

const asEntries = (paths: string[]): Entry[] => paths.map((path) => ({ status: 'M', path }));

describe('Scenario: behavior — a config path reaches the tests that guard it', () => {
  it.each(COMPOSITE_DOT_DIFFS)(
    'when the diff is %s, should reach the whole suite by trigger rather than a subset',
    async (_label, paths) => {
      // given: a gate path beside a path that maps to a test — the shape that used to go unseen
      // when:  the shipped classifier classifies it
      // then:  a trigger, so no list of files stands in for the suite and the guards cannot be
      //        left out by a mapping
      const mod = await loadModule();
      const plan = mod.classifyChanged(asEntries(paths));

      expect(plan.mode, `${paths.join(' ')} must not degrade to a subset`).toBe('full');
      expect(plan.code, 'the suite must come from the trigger, not the unmapped backstop').toBe(
        'trigger'
      );
      expect(plan.paths, 'a full verdict runs everything; it names no files').toEqual([]);
    }
  );

  it.each(ALL_TRIGGERS)(
    'when %s changes, should run the whole suite coded as a trigger',
    async (_label, path) => {
      // given: one representative path per trigger, including the two this slice added
      // when:  the classifier classifies it alone
      // then:  `trigger`, told apart from the unmapped backstop by its code — an arm asserting
      //        `mode` alone cannot distinguish the two ways to reach the whole suite
      const mod = await loadModule();
      const plan = mod.classifyChanged([{ status: 'M', path }]);

      expect(plan.mode).toBe('full');
      expect(plan.code).toBe('trigger');
      expect(plan.paths).toEqual([]);
    }
  );

  it('when a path merely shares the prefix, should not be read as a trigger', async () => {
    // given: paths that begin with the two entries' text but are not under them — the claim is
    //        about the SLASH, so `.githubx/...` is not `.github/` and `.huskys/...` is not `.husky/`
    // when:  the trigger list is asked about each
    // then:  none matches, so the entries are anchored rather than a prefix rule
    const mod = await loadModule();
    for (const path of ['.githubx/workflows/x.yml', '.huskys/pre-push', '.husky']) {
      expect(
        mod.FULL_FALLBACK_TRIGGERS.some((re) => re.test(path)),
        `${path} must not be a full-suite trigger`
      ).toBe(false);
    }
  });
});

describe('Scenario: integration — the rule is bound to the module it lives in', () => {
  it.each(COMPOSITE_DOT_DIFFS)(
    'when the two entries are deleted, should show %s falling back to the subset that missed them',
    async (_label, paths, mapped) => {
      // given: the same diff, and the classifier WITHOUT the two new entries
      // when:  both classify it
      // then:  the before-state reproduces the hole exactly — a subset that does not include the
      //        commit-gate guard suite — so the arm above is a rule a deletion makes false rather
      //        than a restatement of the list it guards
      const mod = await loadModule();
      const planted = await withoutDotTriggers();
      const control = mod.classifyChanged(asEntries(paths));
      const missed = planted.classifyChanged(asEntries(paths));

      expect(control.mode, 'control: the shipped module closes it').toBe('full');
      expect(missed.mode, 'without the two entries the composite diff is a subset again').toBe(
        'subset'
      );
      expect(missed.code).toBe('subset');
      expect(missed.paths, 'the mapping survives, which is what masked the hole').toContain(mapped);
      expect(missed.paths, 'the commit-gate guard suite was not selected').not.toContain(
        'tests/unit/hooks'
      );
      expect(missed.paths, "the classifier's own test file was not selected either").not.toContain(
        'tests/unit/scripts/test-changed-classify.test.ts'
      );
    }
  );

  it.each(DOT_ONLY_ALREADY_FULL)(
    'when the diff is %s, should select exactly what it selected before',
    async (_label, paths) => {
      // given: a dot path with NO mapped path beside it — the shape that already reached the suite
      // when:  both revisions classify it
      // then:  the selection is identical, mode and paths. Only the `code` may move, and only from
      //        the backstop to the rule: a corrected label, not a cost appearing
      const mod = await loadModule();
      const planted = await withoutDotTriggers();
      const control = mod.classifyChanged(asEntries(paths));
      const missed = planted.classifyChanged(asEntries(paths));

      expect(selectionOf(control)).toBe(selectionOf(missed));
      expect(control.mode, 'these five were already the whole suite').toBe('full');
      expect(control.paths).toEqual(missed.paths);
    }
  );

  it.each(NEITHER_DOT_PATH)(
    'when the diff is %s, should be byte-identical to what it was before',
    async (_label, paths) => {
      // given: a diff carrying NEITHER `.github/` nor `.husky/`
      // when:  both revisions classify it
      // then:  the whole Plan — mode, paths, code AND the reason line — is identical, so neither
      //        new entry can have moved a verdict it does not name
      const mod = await loadModule();
      const planted = await withoutDotTriggers();

      expect(mod.classifyChanged(asEntries(paths))).toEqual(
        planted.classifyChanged(asEntries(paths))
      );
    }
  );

  it('when the diff is the exemption alone, should stay exempt and reach its guard suites', async () => {
    // given: R1's artifact alone — the one path the broad `.peaks/` trigger must not catch
    // when:  both revisions classify it, and the two new regexes are asked about it directly
    // then:  the guard suites are the selection in both: the exemption still bites, and neither
    //        new entry matches the path in the first place
    const mod = await loadModule();
    const planted = await withoutDotTriggers();
    const control = mod.classifyChanged([{ status: 'M', path: mod.BASELINE_REL }]);
    const missed = planted.classifyChanged([{ status: 'M', path: mod.BASELINE_REL }]);

    expect(selectionOf(control)).toBe(selectionOf(missed));
    expect(control.code).toBe('r1-readers');

    for (const [source, sample] of [
      ['^\\.github\\/', '.github/workflows/x.yml'],
      ['^\\.husky\\/', '.husky/pre-push']
    ] as ReadonlyArray<readonly [string, string]>) {
      const re = mod.FULL_FALLBACK_TRIGGERS.find((candidate) => candidate.source === source);
      expect(re, `${source} must be in the trigger list`).toBeDefined();
      expect(re?.test(sample), `${source} must match ${sample}`).toBe(true);
      expect(re?.test(mod.BASELINE_REL), `${source} must not catch the exemption`).toBe(false);
    }
  });
});
