// tests/unit/standards/vitest-worker-cap.test.ts
//
// CENSUS GUARD for the vitest worker cap — the case file that makes "the cap is
// shared by every vitest config" a measured property instead of a sentence.
//
// WHY (slice c5-verifier-concurrency, 2026-09-30). `vitest.workers.ts` claims to
// be the single source of truth for the worker count and its header claimed that
// claim covered "all four vitest configs". The repository had SEVEN; the three
// under `packages/*/` imported nothing and set no `pool` / `maxWorkers`, so each
// ran at vitest's own default — one fork per core — on a host that took three
// `0x10E PFN_LIST_CORRUPT` bugchecks the same day whole-program checks overlapped
// (~786 MB for one `tsc --noEmit`, ~985 MB for one type-aware eslint batch). The
// rot mechanism was a hand-maintained count in prose, so this guard carries no
// list: it WALKS, and it names the config that drifted.
//
// TWO ARMS, NO SHARED SOURCE OF TRUTH (the full rationale lives in
// `tests/unit/standards/_vitest-worker-cap-scan.ts`, the scan library):
//   static  — parse each config and ask what `maxWorkers` is ASSIGNED FROM:
//             nothing, a literal (through one hop of `const`), or a binding that
//             traces to an import of `vitest.workers`.
//   dynamic — load each config through vite's own `loadConfigFromFile` (esbuild
//             bundling + evaluation, i.e. the path vitest takes) and require the
//             RESOLVED object to carry `pool: 'forks'`, `maxWorkers` equal to the
//             policy's exported value, and a bundle whose module graph lists
//             `vitest.workers.ts`.
// One arm is this repository's parser, the other is esbuild's resolver.
//
// THE CENSUS IS ANCHORED, AND THE BOUNDARY IS PINNED. The predicate is a basename
// anchored on `vitest.config`. One file sits outside it on purpose:
// `tests/fixtures/bdd-reporter.vitest.config.ts`, which is not a project config —
// `tests/unit/reporters/bdd-reporter.test.ts` spawns it with `--config` to run
// exactly ONE fixture file at a time, so it cannot fan out. An unanchored name at
// a project level would slip through, so the location rule "every wider-shaped
// config lives under `tests/fixtures/`" is asserted too, with its own failing
// example, because a rule that has no positive control is not a rule.
//
// Dimensions covered: render (the failure text), behavior (the decision, on
// fixture trees under OS tmp), integration (the real tree: walked, parsed,
// loaded). a11y is omitted below with its reason.

import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { DEFAULT_MAX_WORKERS, maxWorkers as policyMaxWorkers } from '../../../vitest.workers.js';
import {
  baseName,
  boundaryFindings,
  cappedFixture,
  CENSUS_NAME,
  configFactsUnder,
  decide,
  describeFindings,
  gitProjectFiles,
  listTsFiles,
  loadAsVitestDoes,
  moduleBasename,
  POLICY_MODULE,
  REPO_ROOT,
  withFixtureTree
} from './_vitest-worker-cap-scan.js';

declareDimensions(
  'tests/unit/standards/vitest-worker-cap.test.ts',
  ['render', 'behavior', 'integration'],
  [
    {
      dim: 'a11y',
      reason: 'no user-facing surface: emits no stdout, exit code or message of its own'
    }
  ]
);

// ── integration: the real tree ───────────────────────────────────────

describe('Scenario: integration — every vitest config on disk obeys the policy', () => {
  const allTsFiles = listTsFiles('', REPO_ROOT, []);
  const census = allTsFiles.filter((file) => CENSUS_NAME.test(baseName(file)));

  it('finds the configs by walking, and the walk reaches both homes a config can live in', () => {
    // Anti-vacuity without a hand-kept count: the census must contain at least one
    // config at the repository root and at least one inside a package — the two
    // places a vitest project config can live. Pinning "seven" here would repeat
    // the prose-census mistake this guard exists to end.
    expect(census.some((file) => !file.includes('/'))).toBe(true);
    expect(census.some((file) => file.startsWith('packages/'))).toBe(true);
  });

  it('walks the same file set git reports, so the census cannot narrow silently', () => {
    // The enumeration is cross-measured against a second mechanism (git's index,
    // as tracked ∪ untracked-not-ignored) that shares no recursion with the walk.
    const fromGit = gitProjectFiles()
      .filter((line) => CENSUS_NAME.test(baseName(line)))
      .sort();
    expect([...census].sort()).toEqual(fromGit);
  });

  it('parses a cap that traces to the policy out of every one of them', () => {
    const findings = decide(configFactsUnder(REPO_ROOT));
    expect(findings, describeFindings(findings)).toEqual([]);
  });

  it('loads every one of them the way vitest loads it, with the policy value resolved', async () => {
    for (const file of census) {
      const loaded = await loadAsVitestDoes(file);
      const test = loaded?.config?.test;
      expect(test, `${file}: vite returned no config object`).toBeDefined();
      expect(test?.pool, `${file}: pool`).toBe('forks');
      expect(test?.maxWorkers, `${file}: resolved maxWorkers`).toBe(policyMaxWorkers);
      const bundled = (loaded?.dependencies ?? []).map((d) => d.split('\\').join('/'));
      expect(
        bundled.some((d) => POLICY_MODULE.test(moduleBasename(d))),
        `${file}: its own bundle does not include vitest.workers.ts`
      ).toBe(true);
    }
  });

  it('reads the policy at load time: PEAKS_VITEST_MAX_WORKERS changes what the configs resolve', async () => {
    // The decisive evidence that the cap is READ, not decorative. The policy module
    // is evaluated once PER BUNDLE, so an override set here is observed by every
    // config load below, while this process still holds the constant it imported at
    // collection time. A config that hard-coded 2 would keep reporting 2 here.
    const probe = '3';
    const previous = process.env.PEAKS_VITEST_MAX_WORKERS;
    process.env.PEAKS_VITEST_MAX_WORKERS = probe;
    try {
      for (const file of census.filter((f) => f.startsWith('packages/'))) {
        const loaded = await loadAsVitestDoes(file);
        expect(loaded?.config?.test?.maxWorkers, `${file} must re-read the policy`).toBe(
          Number(probe)
        );
      }
      expect(policyMaxWorkers, 'this process imported the policy before the override').toBe(
        DEFAULT_MAX_WORKERS
      );
    } finally {
      if (previous === undefined) delete process.env.PEAKS_VITEST_MAX_WORKERS;
      else process.env.PEAKS_VITEST_MAX_WORKERS = previous;
    }
    for (const file of census) {
      const reloaded = await loadAsVitestDoes(file);
      expect(reloaded?.config?.test?.maxWorkers, `${file} after the override is removed`).toBe(
        policyMaxWorkers
      );
    }
  });

  it('keeps the one unanchored vitest-config file inside the fixture tree', () => {
    const findings = boundaryFindings(allTsFiles);
    expect(findings, describeFindings(findings)).toEqual([]);
  });
});

// ── behavior: the decision, on fixture trees under OS tmp ────────────

describe('Scenario: behavior — the rule, driven through fixture trees', () => {
  it('reports a config that declares no cap at all (the packages/ defect of 2026-09-30)', () => {
    withFixtureTree(
      {
        'packages/p/vitest.config.ts':
          `import { defineConfig } from 'vitest/config';\n\n` +
          `export default defineConfig({ test: { include: ['tests/**/*.test.ts'] } });\n`
      },
      (root) => {
        const findings = decide(configFactsUnder(root));
        expect(findings).toEqual([
          {
            file: 'packages/p/vitest.config.ts',
            reason: 'declares no `maxWorkers` at all, so it fans out to one fork per core'
          }
        ]);
        // The message has to name the file, or it is not actionable at seven.
        expect(describeFindings(findings)).toContain('packages/p/vitest.config.ts');
      }
    );
  });

  it('reports a cap that is a literal rather than the shared policy', () => {
    withFixtureTree(
      { 'vitest.config.ts': `export default { test: { maxWorkers: 2 } };\n` },
      (root) => {
        expect(decide(configFactsUnder(root))).toEqual([
          {
            file: 'vitest.config.ts',
            reason: 'hard-codes `maxWorkers` as a number instead of importing `vitest.workers.ts`'
          }
        ]);
      }
    );
  });

  it('reports a commented-out cap, a literal hidden behind a const, and a cap wired elsewhere', () => {
    withFixtureTree(
      {
        'vitest.config.a.ts': `export default { test: { /* maxWorkers: 2 */ } };\n`,
        'vitest.config.b.ts': `const other = 4;\nexport default { test: { maxWorkers: other } };\n`,
        'vitest.config.c.ts':
          `import { maxWorkers as w } from './local-policy.js';\n` +
          `export default { test: { maxWorkers: w } };\n`
      },
      (root) => {
        const shapes = configFactsUnder(root)
          .map((fact) => `${fact.file}=${fact.shape}`)
          .sort();
        expect(shapes).toEqual([
          // Comments are not AST nodes: a commented-out cap is no cap.
          'vitest.config.a.ts=absent',
          // One hop of `const` is followed, so a literal wearing a name is still
          // the restated-number defect this slice exists to remove.
          'vitest.config.b.ts=literal',
          // A cap imported from SOMEWHERE is not a cap imported from the policy.
          'vitest.config.c.ts=untraceable'
        ]);
      }
    );
  });

  it('accepts a config that imports the policy, directly or through one hop of const', () => {
    // The control for the controls: the rule must be able to PASS, otherwise the
    // cases above prove only that `decide` never returns [].
    withFixtureTree(
      {
        'vitest.config.ts': cappedFixture('../../vitest.workers.js'),
        'vitest.config.hop.ts':
          `import { maxWorkers as workerCount } from '../../vitest.workers.js';\n` +
          `const maxWorkers = workerCount;\n` +
          `export default { test: { pool: 'forks', maxWorkers } };\n`
      },
      (root) => {
        expect(decide(configFactsUnder(root))).toEqual([]);
      }
    );
  });

  it('names a project-level config the anchored census would otherwise miss', () => {
    // The boundary arm's own positive control: an unanchored name OUTSIDE the
    // fixture tree is the one shape that could hide from the census, and it has to
    // be reported; the fixture-tree and anchored shapes are not.
    expect(
      boundaryFindings([
        'tools/nested.vitest.config.ts',
        'tests/fixtures/bdd-reporter.vitest.config.ts',
        'vitest.config.e2e.ts'
      ])
    ).toEqual([
      {
        file: 'tools/nested.vitest.config.ts',
        reason:
          'a vitest-config-shaped file outside `tests/fixtures/` is invisible to the anchored census'
      }
    ]);
  });
});

// ── render: the failure message ──────────────────────────────────────

describe('Scenario: render — the failure message names the drifted config', () => {
  it('prints the path and the reason for every drift', () => {
    const message = describeFindings([
      {
        file: 'packages/peaks-loop-mut/vitest.config.ts',
        reason: 'declares no `maxWorkers` at all'
      },
      { file: 'vitest.config.lint.ts', reason: 'sets a literal' }
    ]);
    expect(message).toContain('2 vitest config(s) are outside the shared worker policy');
    expect(message).toContain('packages/peaks-loop-mut/vitest.config.ts');
    expect(message).toContain('vitest.config.lint.ts');
    expect(message).toContain('vitest.workers.ts');
  });

  it('says nothing when every config holds', () => {
    expect(describeFindings([])).toBe('');
  });
});
