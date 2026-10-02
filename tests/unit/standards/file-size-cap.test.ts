// tests/unit/standards/file-size-cap.test.ts
//
// CENSUS GUARD for the file-size cap — the case file that makes "one policy,
// counted the same way everywhere" a measured property instead of a sentence.
//
// WHY (rid 2026-09-30-cap-unify-01). The repo wrote one decision twice, in two
// units: `max-lines: [error, {max: 400, skipBlankLines, skipComments}]` in
// `config/eslint/.peaks-rules.cjs` and `DEFAULT_FILE_SIZE_THRESHOLD = 800` raw in
// `src/services/scan/file-size-scan.ts`. Nothing observed the two copies against
// each other, so they disagreed by construction — and the only file-size number
// the gate ratcheted was `eslintFindings`, which counts a DIFFERENT population
// (98 `max-lines` findings under 400-effective vs 174 files over the decided
// 300/500 raw). The policy now lives in ONE module and the whole-tree count has
// its own ceiling row, `fileSizeOverCap`. This file is what keeps it that way.
//
// THE SHAPE IS THE PRECEDENT'S. `tests/unit/standards/vitest-worker-cap.test.ts`
// exists because a hand-maintained count in prose rotted; this guard carries no
// list of files, no list of caps, and no repo number of its own. It WALKS the
// filesystem, counts with the policy's own functions, spawns the census tool the
// gate spawns, reads the published artifact, and names whatever drifted.
//
// FOUR READINGS OF ONE FACT, no two of them sharing a mechanism:
//   walk     — this library's recursion over the filesystem
//   git      — `git ls-files`, the index plus untracked-and-not-ignored
//   tool     — `scripts/lint/file-size-census.ts` through tsx, JSON envelope
//   artifact — `.peaks/lint/gate-baseline.json` `ceilings.fileSizeOverCap`
// The first two prove the scope cannot narrow silently; the third proves the
// ceiling was MEASURED (the generator copies that envelope, it cannot type a
// number); the fourth proves the row the gate compares against is the number the
// tool reported. `scripts/` is inside the scope because the 174 counts it — a row
// that silently excluded `scripts` would not equal its own measurement (the §4b
// class of hole), and the four-dir membership arm below is the anti-vacuity for
// that claim.
//
// THE SECOND-COPY ARMS ARE THE POINT. Two structural rules, both with a failing
// example so they cannot pass by measuring nothing: a numeric constant named like
// a line cap outside the policy module (the exact shape `DEFAULT_FILE_SIZE
// THRESHOLD = 800` had), and a file-size-cap file that never imports the policy.
//
// Dimensions covered: render (the failure text), behavior (the two rules, on
// fixture trees under OS tmp), integration (the real tree, walked, counted,
// spawned, published), a11y (the census tool's own exit codes — it must be able
// to report 0 and mean it).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  FILE_SIZE_CAP_DEFAULT,
  FILE_SIZE_CAP_TESTS,
  FILE_SIZE_SCOPE_DIRS,
  FILE_SIZE_SCOPE_EXTENSIONS,
  isPolicyMeasuredFile
} from '../../../src/services/scan/file-size-policy.js';
import {
  BASELINE_PATH,
  CENSUS_TOOL_PATH,
  POLICY,
  POLICY_MODULE_PATH,
  REPO_ROOT,
  capCopyFindings,
  censusCountedFiles,
  censusRun,
  describeFindings,
  gateModuleText,
  generatorModuleTextUnder,
  gitScopedFiles,
  overCapFixture,
  overCapFromWalk,
  policyWiringFindings,
  runCensus,
  walkScopedFiles,
  withFixtureTree
} from './_file-size-cap-scan.js';

declareDimensions(
  'tests/unit/standards/file-size-cap.test.ts',
  ['render', 'behavior', 'integration', 'a11y'],
  []
);

type PublishedBaseline = {
  ceilings: Record<string, unknown>;
  fileSizeLineConvention?: string;
  fileSizePolicyInputs?: {
    defaultCap: number;
    testsCap: number;
    scopeDirs: string[];
    scopeExtensions: string[];
  };
  files?: Record<string, unknown>;
};

function published(): PublishedBaseline {
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as PublishedBaseline;
}

/** The ceiling the gate compares against, read off the artifact — never typed. */
function publishedCeiling(): number {
  const value = published().ceilings.fileSizeOverCap;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(
      'the baseline has no integer ceiling at "fileSizeOverCap": run node .husky/peaks-gate-baseline.mjs'
    );
  }
  return value;
}

const SORTED = (files: readonly string[]): string[] => [...files].sort();

// ── integration: the real tree ───────────────────────────────────────

describe('Scenario: integration — one scope, counted four ways', () => {
  it('walks the same file set git reports, so the scope cannot narrow silently', () => {
    // Two enumerations that share no recursion. A scope rule that lost a
    // directory, or a walk that stopped descending, shows up here as a set
    // difference naming the files — not as a smaller number nobody noticed.
    expect(SORTED(walkScopedFiles(REPO_ROOT))).toEqual(SORTED(gitScopedFiles(REPO_ROOT)));
  });

  it('reaches all four scope dirs by walking, so the scope is not one dir narrower than the policy', () => {
    // Anti-vacuity without a hand-kept count: `scripts` in particular must be
    // inside what is measured, because the seeded row counts 5 files in it and a
    // row that excluded them would disagree with its own census.
    const walked = walkScopedFiles(REPO_ROOT);
    for (const dir of ['src', 'tests', 'packages', 'scripts']) {
      expect(
        walked.some((file) => file.startsWith(`${dir}/`)),
        dir
      ).toBe(true);
    }
    expect(runCensus().scope.dirs).toEqual(['src', 'tests', 'packages', 'scripts']);
  });

  it('counts the same over-cap files from the walk and from the census the gate runs', () => {
    const fromWalk = overCapFromWalk(REPO_ROOT);
    const envelope = runCensus();
    // Same SET of files: a cap applied to one scope and not the other, or a line
    // convention that differs, moves one side and not both.
    expect(SORTED(fromWalk.map((entry) => entry.file))).toEqual(
      SORTED(envelope.files.map((entry) => entry.file))
    );
    // And the same verdict per file, so "over cap" is one rule and not two.
    for (const entry of fromWalk) {
      const reported = envelope.files.find((f) => f.file === entry.file);
      expect(reported?.lines, `${entry.file} line count`).toBe(entry.lines);
      expect(reported?.cap, `${entry.file} cap`).toBe(entry.cap);
    }
    expect(envelope.overCap).toBe(fromWalk.length);
  });

  it('published the ceiling it measured, in the unit the policy names', () => {
    const envelope = runCensus();
    // The artifact cannot contain a number the tool did not report, and it
    // cannot forget the unit: 174 files counted by `split('\n')` is not 174
    // files counted by `wc -l` once the excess lines are summed.
    expect(publishedCeiling()).toBe(envelope.overCap);
    expect(publishedCeiling()).toBe(overCapFromWalk(REPO_ROOT).length);
    expect(published().fileSizeLineConvention).toBe(POLICY.convention);
    expect(envelope.convention).toBe(POLICY.convention);
    expect(envelope.caps).toEqual({
      defaultCap: POLICY.defaultCap,
      testsCap: POLICY.testsCap
    });
  });

  it('keeps every bucket of the census keyed, so a measured zero is not a missing scope', () => {
    const envelope = runCensus();
    expect(Object.keys(envelope.byDir).sort()).toEqual(
      ['packages', 'scripts', 'src', 'tests'].sort()
    );
    const summed = Object.values(envelope.byDir).reduce((n, b) => n + b.files, 0);
    expect(summed).toBe(envelope.overCap);
  });

  it('defines the cap in one file: no second copy, and every cap-enforcer reads it', () => {
    const copies = capCopyFindings(REPO_ROOT);
    expect(copies, describeFindings(copies, 'one cap definition')).toEqual([]);
    const unwired = policyWiringFindings(REPO_ROOT);
    expect(unwired, describeFindings(unwired, 'policy wiring')).toEqual([]);
  });

  it('took the 800 out of the scan, and resolves its threshold from the policy instead', () => {
    // The literal criterion: `DEFAULT_FILE_SIZE_THRESHOLD = 800` is gone, and the
    // module that replaced it is imported by name rather than restated.
    const scan = readFileSync(
      join(REPO_ROOT, 'src', 'services', 'scan', 'file-size-scan.ts'),
      'utf8'
    );
    expect(scan).not.toContain('DEFAULT_FILE_SIZE_THRESHOLD');
    expect(scan).not.toContain('= 800');
    expect(scan).toContain('file-size-policy.js');
    expect(scan).toContain('fileSizeCapFor');
  });
});

// ── behavior: the two rules, on fixture trees ────────────────────────

describe('Scenario: behavior — a second copy of the cap is reported', () => {
  it('names a consumer that re-typed the historical 800 instead of reading the policy', () => {
    withFixtureTree(
      {
        'src/services/scan/file-size-scan.ts':
          'export const DEFAULT_FILE_SIZE_THRESHOLD = 800;\n' +
          'export const THRESHOLD = DEFAULT_FILE_SIZE_THRESHOLD;\n'
      },
      (root) => {
        const findings = capCopyFindings(root);
        expect(findings.map((f) => f.file)).toEqual(['src/services/scan/file-size-scan.ts']);
        expect(findings[0]?.reason).toContain('DEFAULT_FILE_SIZE_THRESHOLD');
        // The same file also fails the wiring rule: it enforces a cap and never
        // imports the policy, so the two arms are independent, not one test twice.
        expect(policyWiringFindings(root).map((f) => f.file)).toEqual([
          'src/services/scan/file-size-scan.ts'
        ]);
      }
    );
  });

  it('names a file-size enforcer that computes its own threshold', () => {
    withFixtureTree(
      {
        // No cap-shaped constant at all — a cap reached by another route (a
        // literal in a comparison) still has to import the policy to be the
        // policy, and this file does not.
        'src/services/scan/file-size-guard.ts': 'export const OK = true;\n'
      },
      (root) => {
        const findings = policyWiringFindings(root);
        expect(findings.map((f) => f.file)).toEqual(['src/services/scan/file-size-guard.ts']);
        expect(findings[0]?.reason).toContain('does not import');
        expect(capCopyFindings(root)).toEqual([]);
      }
    );
  });

  it('leaves a number that is not a cap alone', () => {
    // The false-positive control. `no-magic-numbers` already flags loose numbers
    // repo-wide; this rule is about NAMES that claim to be the file-size policy,
    // so an unrelated 800 in an unrelated file must not be reported.
    withFixtureTree(
      {
        'src/services/bench/token-budget.ts': 'export const BUDGET_TOKENS = 800;\n'
      },
      (root) => {
        expect(capCopyFindings(root)).toEqual([]);
        expect(policyWiringFindings(root)).toEqual([]);
      }
    );
  });

  it('leaves a line-count number that answers a different question alone, and says so (F6)', () => {
    // `legacy-detector.ts` holds a 500 that the name-based rule above cannot see.
    // It is NOT a copy of the cap — it reports a smell, it does not decide what may
    // be committed, and folding it into the policy would silently turn all 134
    // over-cap `src/` files into "legacy" findings. The decision is what this arm
    // protects: the adjudication has to stay readable where the number lives, and
    // the cap has to stay 300/500, which the artifact's recorded inputs pin.
    const detector = readFileSync(
      join(REPO_ROOT, 'src', 'services', 'legacy', 'legacy-detector.ts'),
      'utf8'
    );
    const at = detector.indexOf('const LARGE_FILE_LINES');
    expect(at).toBeGreaterThan(-1);
    const declared = detector.slice(0, at);
    expect(declared).toContain('NOT the file-size cap');
    expect(declared).toContain('file-size-policy');
    expect(declared).toContain('lint-gate.md');
    // ...and it is not the policy's number: the caps the artifact was seeded under
    // are still the two this module defines.
    expect(POLICY.caps).toEqual({
      defaultCap: FILE_SIZE_CAP_DEFAULT,
      testsCap: FILE_SIZE_CAP_TESTS
    });
  });

  it('accepts the policy module itself, and a consumer that reads it', () => {
    // The rules must be able to PASS, otherwise the cases above prove only that
    // they never return [].
    withFixtureTree(
      {
        [POLICY_MODULE_PATH]:
          'export const FILE_SIZE_CAP_DEFAULT = 300;\nexport const FILE_SIZE_CAP_TESTS = 500;\n',
        'src/services/scan/file-size-scan.ts':
          "import { fileSizeCapFor } from './file-size-policy.js';\n" +
          'export const cap = fileSizeCapFor;\n'
      },
      (root) => {
        expect(capCopyFindings(root)).toEqual([]);
        expect(policyWiringFindings(root)).toEqual([]);
      }
    );
  });

  it('counts a package test file at the package cap, not the root tests cap', () => {
    // The reading decided 2026-09-30, asserted where the caps are defined so the
    // census and the scan cannot each have their own idea of `tests`.
    expect(POLICY.caps.defaultCap).toBe(FILE_SIZE_CAP_DEFAULT);
    withFixtureTree(
      {
        'tests/unit/a.test.ts': overCapFixture(POLICY.testsCap),
        'packages/p/tests/b.test.ts': overCapFixture(POLICY.defaultCap)
      },
      (root) => {
        const entries = overCapFromWalk(root).map((entry) => `${entry.file}:${entry.cap}`);
        expect([...entries].sort()).toEqual([
          'packages/p/tests/b.test.ts:300',
          'tests/unit/a.test.ts:500'
        ]);
      }
    );
  });
});

// ── render: the failure text ─────────────────────────────────────────

describe('Scenario: render — the failure names the file and the policy', () => {
  it('prints the path, the rule and where the cap actually lives', () => {
    const message = describeFindings(
      [{ file: 'src/services/scan/file-size-scan.ts', reason: 'defines FILE_SIZE_CAP = 250' }],
      'one cap definition'
    );
    expect(message).toContain('src/services/scan/file-size-scan.ts');
    expect(message).toContain('one cap definition');
    expect(message).toContain(POLICY_MODULE_PATH);
  });

  it('says nothing when every file holds', () => {
    expect(describeFindings([], 'one cap definition')).toBe('');
  });
});

// ── a11y: the tool's own exit codes ─────────────────────────────────

describe('Scenario: a11y — the census reports 0 only when it means 0', () => {
  it('exits 0 with an empty over-cap list when the one file it counted is under cap', () => {
    // The positive control for the whole row: a census that can only return
    // non-zero, or that cannot run at all, is indistinguishable from debt.
    withFixtureTree({ 'under-cap.ts': 'a\nb\nc\n' }, (root) => {
      const run = censusRun([join(root, 'under-cap.ts')]);
      expect(run.envelope.overCap).toBe(0);
      expect(run.envelope.scope.countedFiles).toBe(1);
      expect(run.status).toBe(0);
    });
  });

  it('exits 1 and names the file when the one file it counted is over cap', () => {
    withFixtureTree({ 'over-cap.ts': overCapFixture(FILE_SIZE_CAP_DEFAULT) }, (root) => {
      const run = censusRun([join(root, 'over-cap.ts')]);
      expect(run.envelope.overCap).toBe(1);
      expect(run.envelope.files[0]?.file).toContain('over-cap.ts');
      expect(run.status).toBe(1);
    });
  });

  it('refuses to produce an envelope it cannot measure', () => {
    // A path that is not there must CRASH the census, not print `overCap: 0`.
    // Both callers read that as "the census could not run" and fail closed.
    expect(() => censusRun([join(REPO_ROOT, 'src', 'not-there-file-size.ts')])).toThrow();
  });

  it('is the tool the gate spawns, through one shared measurement path', () => {
    // Wiring matters: a census nothing points at enforces nothing — the posture
    // `lint-file-list-parity.test.ts` takes for `pnpm lint`. Since repair cycle F5
    // the two callers reach it through `.husky/peaks-gate-file-size.mjs` instead of
    // each spawning it, so the assertion follows the spawn rather than the file.
    //
    // THE GATE SIDE POOLS THE MODULE SET (rid 2026-10-02-wave9-gate-entry-split).
    // The gate's regions moved to `.husky/gate/*.mjs`, so `FS_CEILING_KEY` and the
    // specifier that reaches the shared leg now live in a sibling, not in the entry.
    // Reading one file would go red because the symbol MOVED; keeping the string in
    // the entry to avoid that would be the §2.28 defect in reverse. `gateModuleText`
    // walks `.husky/gate/` and reads all of it — the two arms after this one are what
    // prove the pool is a check and not a cushion.
    const gate = gateModuleText();
    // POOLED over the generator's module set for the same reason (rid
    // 2026-10-02-wave9-generator-split): the region that imports the shared leg is now
    // `.husky/baseline/census-leg.mjs`, and the walk finds it wherever it lives.
    const generator = generatorModuleTextUnder(REPO_ROOT);
    const shared = readFileSync(join(REPO_ROOT, '.husky', 'peaks-gate-file-size.mjs'), 'utf8');
    expect(shared).toContain(CENSUS_TOOL_PATH);
    expect(gate).toContain('peaks-gate-file-size.mjs');
    expect(generator).toContain('peaks-gate-file-size.mjs');
    // The row's key is spelled once, in the shared module, and read by both callers
    // through `FS_CEILING_KEY` — the same single-source posture the cap itself has.
    expect(shared).toContain('fileSizeOverCap');
    expect(gate).toContain('FS_CEILING_KEY');
  });

  it('refuses a named-file subset and disclaims the control arm it does accept (F1)', () => {
    // The leg may not report `ceiling held` for a run that measured one file.
    const shared = readFileSync(join(REPO_ROOT, '.husky', 'peaks-gate-file-size.mjs'), 'utf8');
    expect(shared).toContain('refuseScopedSubset');
    expect(shared).toContain('CONTROL ARM');
    expect(shared).not.toMatch(/function refuseScopedSubset[\s\S]{0,400}ceiling held/);
  });

  it('binds fileSizeOverCap to the policy inputs that produced it (F2)', () => {
    // The artifact carried the line convention and nothing else, so re-deciding the
    // cap re-decided the number the row ratchets: measured 300/500 → 174, 400/600 →
    // 162, 800 → 40 GREEN. The recorded inputs are what turn that into a refusal.
    const artifact = published();
    const inputs = artifact.fileSizePolicyInputs;
    expect(inputs, 'the baseline must record the caps it was seeded under').toBeDefined();
    expect(inputs?.defaultCap).toBe(POLICY.defaultCap);
    expect(inputs?.testsCap).toBe(POLICY.testsCap);
    expect(inputs?.scopeDirs).toEqual([...FILE_SIZE_SCOPE_DIRS]);
    expect(inputs?.scopeExtensions).toEqual([...FILE_SIZE_SCOPE_EXTENSIONS]);
    // And the envelope the gate reads carries the same fields, so the leg has
    // something to re-derive: a recorded input with no live counterpart is a
    // comparison that can never run.
    const envelope = runCensus();
    expect(envelope.caps).toEqual({
      defaultCap: inputs?.defaultCap,
      testsCap: inputs?.testsCap
    });
    expect(envelope.scope.dirs).toEqual(inputs?.scopeDirs);
    expect(envelope.scope.extensions).toEqual(inputs?.scopeExtensions);
    const generator = generatorModuleTextUnder(REPO_ROOT);
    expect(generator).toContain('fileSizePolicyInputs');
    // Pooled, for the reason in the wiring arm above: the binding check is part of
    // the file-size LEG, and the leg is now `.husky/gate/legs.mjs`.
    expect(gateModuleText()).toContain('fileSizeInputTrips(');
  });

  it('measures one scope in the scan and in the census, not two (F3)', () => {
    // The census filtered `git ls-files` by the extension half; the scan filtered
    // nothing at all, so a 320-line file under `.husky/` reddened a transition the
    // row could never see or descend. Both now read `isPolicyMeasuredFile`.
    const scan = readFileSync(
      join(REPO_ROOT, 'src', 'services', 'scan', 'file-size-scan.ts'),
      'utf8'
    );
    const census = readFileSync(join(REPO_ROOT, CENSUS_TOOL_PATH), 'utf8');
    expect(scan).toContain('isPolicyMeasuredFile');
    expect(census).toContain('isPolicyMeasuredFile');
    expect(scan).toContain('outOfScopeFiles');
    // A file outside the scope is not "under the cap", it is UNMEASURED by the
    // policy: naming it keeps the two verdicts from being conflated.
    for (const file of ['.husky/peaks-gate.mjs', 'docs/a.md', 'package.json', 'src/a.json']) {
      expect(isPolicyMeasuredFile(file), file).toBe(false);
    }
    for (const file of [
      'src/a.ts',
      'tests/a.ts',
      'packages/p/src/a.tsx',
      'scripts/lint/a.mjs',
      'src/a.cjs'
    ]) {
      expect(isPolicyMeasuredFile(file), file).toBe(true);
    }
  });

  it('records a baseline entry for every file the census counts (F4)', () => {
    // The other half of the artifact's contract: the ceilings are cross-measured by
    // the arms above, but the per-file entries the staged and changed legs read have
    // no guard, and on 2026-09-30 the committed artifact was 1424 entries against a
    // 1429-file scope — the slice's own five new files were simply absent, and a
    // gate that has never seen a file cannot say it did not get worse.
    const counted = censusCountedFiles(REPO_ROOT);
    const entries = published().files ?? {};
    const missing = counted.filter((file) => !(file in entries));
    expect(
      missing,
      `gate-baseline.json has no files[] entry for: ${missing.join(', ')} — ` +
        'run node .husky/peaks-gate-baseline.mjs'
    ).toEqual([]);
    // Measured zero is not a missing scope: the census's own count must agree.
    expect(counted.length).toBe(runCensus().scope.countedFiles);
  });
});
