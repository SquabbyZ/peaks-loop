// tests/unit/standards/bdd-test-style-ratchet.test.ts
//
// A shrink-only ratchet for the BDD test-style contract.
//
// THE DEBT THIS LOCKS. `src/services/qa/bdd-test-style-verifier.ts` checks the
// contract in `contracts/test-style-contract.md`: an `it()` / `test()` description
// must include `when` or `should` — at least one of the two (`when X, should Y`
// is the idiomatic form, a preference rather than a requirement) — and the
// callback body must start with exactly `// given:` / `// when:` / `// then:`
// (`// arrange:` / `// act:` / `// assert:` are not this contract's vocabulary).
// The checker existed and NO CI GATE CALLED IT, so it rotted. Measured 2026-10-23
// over the tracked `tests/**/*.test.ts` population: 691 files, 92 conforming,
// 599 violating — 4996 violating calls.
//
// The backlog's §21.9 recorded 11 pre-existing violations. That 11 was measured
// over the files ONE session happened to touch, not over the tree; the repo-wide
// measurement is the 599 this baseline records. Rewriting 599 long-standing
// suites is a separate, larger change, so this slice records the debt instead
// and makes it SHRINK-ONLY.
//
// WHY A RECORDED BASELINE AND NOT A ZERO FLOOR. A zero floor would fail on the
// tree this slice was written against, so it could never be committed. The
// baseline is the implementation-time measurement and the RATCHET DIRECTION is
// the mechanism: the only way the number moves is DOWN (fix a file and shrink its
// entry) or sideways behind a deliberate, reviewable baseline edit.
//
// HOW A NEW VIOLATION IS CAUGHT. `git ls-files -z -- tests` names the population
// — tracked files only, so an untracked scratch file cannot red the suite — and
// `.peaks/lint/bdd-test-style-baseline.json` says which files are allowed to
// carry how many violating calls. The comparison is the pure `compareBaseline`,
// which is also driven with a synthetic population in the control arms below so
// the failure direction is observed, not assumed.
//
// FAILURE MESSAGES. `describeViolations` renders the file, the count and the
// reason; the `render` scenario pins that text.
//
// Omitting the `a11y` dimension: this guard has no human-visible surface of its
// own — it emits no stdout, no exit code and no message outside a vitest
// assertion, whose text is covered by `render`.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  buildBddStylePopulation,
  compareBaseline,
  trackedTestFiles,
  type BddStyleBaseline,
  type BddStyleBaselineViolation,
  type BddStyleFileViolation
} from './_bdd-test-style-scan.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const BASELINE_PATH = join(REPO_ROOT, '.peaks/lint/bdd-test-style-baseline.json');

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as BddStyleBaseline;

declareDimensions(
  'tests/unit/standards/bdd-test-style-ratchet.test.ts',
  ['behavior', 'integration', 'render'],
  [
    {
      dim: 'a11y',
      reason: 'no user-facing surface: emits no stdout, exit code or message of its own'
    }
  ]
);

function describeViolations(violations: readonly BddStyleBaselineViolation[]): string {
  return violations
    .map((violation) => {
      switch (violation.kind) {
        case 'unblessed':
          return (
            `${violation.path}: ${violation.violations} violating test call(s) in a file absent ` +
            `from the baseline — ${violation.reason} at line ${violation.line}`
          );
        case 'count-mismatch':
          return (
            `${violation.path}: ${violation.violations} violating test call(s), ` +
            `baseline records ${violation.expected}`
          );
        case 'stale':
          return (
            `${violation.path}: baseline records violating test calls, but the file now conforms ` +
            `— the ratchet may only shrink — remove this entry from the baseline`
          );
        default: {
          const exhaustive: never = violation;
          return exhaustive;
        }
      }
    })
    .join('\n');
}

/** A baseline that records one file, for the synthetic control arms. */
function syntheticBaseline(entry: BddStyleBaseline['files'][number]): BddStyleBaseline {
  return {
    version: 1,
    generatedAt: '2026-10-23T00:00:00.000Z',
    note: 'synthetic',
    scope: { dirs: ['tests'], pattern: '*.test.ts' },
    totals: { violatingFiles: 1, violations: entry.violations },
    files: [entry]
  };
}

// ── behavior: the detector can fail ─────────────────────────────────

describe('Scenario: behavior — the detector can fail, and only on a violation', () => {
  it('when a file violates outside the baseline, should report it as unblessed', () => {
    // given: a population that violates in a file the baseline does not record
    // when: the population is compared with a baseline that records another file
    // then: both directions are named, and nothing else is
    const population = new Map<string, BddStyleFileViolation>([
      [
        'tests/unit/new.test.ts',
        {
          path: 'tests/unit/new.test.ts',
          violations: 2,
          reason: 'missing-given-when-then',
          line: 17
        }
      ]
    ]);
    const synthetic = syntheticBaseline({
      path: 'tests/unit/gone.test.ts',
      violations: 1,
      reason: 'description-no-should-when',
      line: 4
    });

    expect(compareBaseline(population, synthetic)).toEqual([
      {
        kind: 'unblessed',
        path: 'tests/unit/new.test.ts',
        violations: 2,
        reason: 'missing-given-when-then',
        line: 17
      },
      { kind: 'stale', path: 'tests/unit/gone.test.ts', violations: 0 }
    ]);
  });

  it('when a baselined file has a changed violating-call count, should report a count mismatch', () => {
    // given: a file whose violating-call count grew
    // when: the population is compared with a baseline that records one call
    // then: the count change is named, and the file is not also reported as unblessed
    const population = new Map<string, BddStyleFileViolation>([
      [
        'tests/unit/known.test.ts',
        {
          path: 'tests/unit/known.test.ts',
          violations: 3,
          reason: 'description-no-should-when',
          line: 9
        }
      ]
    ]);
    const synthetic = syntheticBaseline({
      path: 'tests/unit/known.test.ts',
      violations: 1,
      reason: 'description-no-should-when',
      line: 9
    });

    expect(compareBaseline(population, synthetic)).toEqual([
      { kind: 'count-mismatch', path: 'tests/unit/known.test.ts', violations: 3, expected: 1 }
    ]);
  });

  it('when the population and the baseline agree, should report nothing', () => {
    // given: a population and a baseline that describe the same file
    // when: the two are compared
    // then: the comparison is empty
    const population = new Map<string, BddStyleFileViolation>([
      [
        'tests/unit/known.test.ts',
        {
          path: 'tests/unit/known.test.ts',
          violations: 1,
          reason: 'missing-given-when-then',
          line: 12
        }
      ]
    ]);
    const synthetic = syntheticBaseline({
      path: 'tests/unit/known.test.ts',
      violations: 1,
      reason: 'missing-given-when-then',
      line: 12
    });

    expect(compareBaseline(population, synthetic)).toEqual([]);
  });
});

// ── integration: the real tree against the recorded baseline ────────

describe('Scenario: integration — the ratchet walks tracked tests and matches the baseline', () => {
  const filesFromGit = trackedTestFiles(REPO_ROOT);
  const population = buildBddStylePopulation(REPO_ROOT);

  it('when the tracked test files are enumerated, should reach a non-empty population', () => {
    // given: the tracked test population
    // when: the enumeration is read
    // then: the enumeration is not empty
    expect(filesFromGit.length).toBeGreaterThan(0);
  });

  it('when the population is measured, should be neither empty nor the whole tree', () => {
    // given: the measured population of violating files
    // when: its size is compared with the tracked file count
    // then: some files conform and some do not, so the comparison is not vacuous
    expect(population.size).toBeGreaterThan(0);
    expect(population.size).toBeLessThan(filesFromGit.length);
  });

  it('when every violating file is measured, should match the recorded counts', () => {
    // given: the measured population and the recorded baseline
    // when: the two are compared
    // then: no unblessed file and no changed count
    const violations = compareBaseline(population, baseline);
    const unblessedOrChanged = violations.filter((violation) => violation.kind !== 'stale');
    expect(unblessedOrChanged, describeViolations(unblessedOrChanged)).toEqual([]);
  });

  it('when every recorded file still violates, should report no stale baseline entry', () => {
    // given: the measured population and the recorded baseline
    // when: the comparison is filtered for stale entries
    // then: there are none
    const stale = compareBaseline(population, baseline).filter(
      (violation) => violation.kind === 'stale'
    );
    expect(stale, describeViolations(stale)).toEqual([]);
  });

  it('when the totals are compared, should match the measured totals', () => {
    // given: the measured population
    // when: its totals are compared with the recorded totals
    // then: the totals the baseline publishes are the totals that were measured
    const measuredFiles = population.size;
    const measuredViolations = [...population.values()].reduce(
      (sum, file) => sum + file.violations,
      0
    );
    expect(baseline.totals.violatingFiles).toBe(measuredFiles);
    expect(baseline.totals.violations).toBe(measuredViolations);
  });
});

// ── render: the failure message ─────────────────────────────────────

describe('Scenario: render — the failure message names the file, the count and the reason', () => {
  it('when an unblessed violation is rendered, should name the file, the count and the reason', () => {
    // given: an unblessed violation
    // when: the message is rendered
    // then: the message names every part of the failure
    const message = describeViolations([
      {
        kind: 'unblessed',
        path: 'tests/unit/a.test.ts',
        violations: 3,
        reason: 'missing-given-when-then',
        line: 42
      }
    ]);
    expect(message).toContain('tests/unit/a.test.ts');
    expect(message).toContain('3 violating test call(s)');
    expect(message).toContain('missing-given-when-then');
    expect(message).toContain('line 42');
  });

  it('when a stale entry is rendered, should tell the reader to shrink it', () => {
    // given: a stale baseline entry
    // when: the message is rendered
    // then: the message names the file and the shrink rule
    const message = describeViolations([
      { kind: 'stale', path: 'tests/unit/gone.test.ts', violations: 0 }
    ]);
    expect(message).toContain('tests/unit/gone.test.ts');
    expect(message).toContain('the ratchet may only shrink');
    expect(message).toContain('remove this entry from the baseline');
  });
});
