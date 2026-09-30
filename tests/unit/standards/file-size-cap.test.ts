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
import { FILE_SIZE_CAP_DEFAULT } from '../../../src/services/scan/file-size-policy.js';
import {
  BASELINE_PATH,
  CENSUS_TOOL_PATH,
  POLICY,
  POLICY_MODULE_PATH,
  REPO_ROOT,
  capCopyFindings,
  censusRun,
  describeFindings,
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

  it('is the tool the gate spawns, by name', () => {
    // Wiring matters: a census nothing points at enforces nothing — the posture
    // `lint-file-list-parity.test.ts` takes for `pnpm lint`.
    const gate = readFileSync(join(REPO_ROOT, '.husky', 'peaks-gate.mjs'), 'utf8');
    const generator = readFileSync(join(REPO_ROOT, '.husky', 'peaks-gate-baseline.mjs'), 'utf8');
    expect(gate).toContain(CENSUS_TOOL_PATH);
    expect(generator).toContain(CENSUS_TOOL_PATH);
    expect(gate).toContain('fileSizeOverCap');
  });
});
