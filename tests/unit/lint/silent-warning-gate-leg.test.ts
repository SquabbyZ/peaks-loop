// tests/unit/lint/silent-warning-gate-leg.test.ts
//
// Slice a3 — the injection control for the two silent-warning ratchet legs.
//
// THE DEFECT THIS PINS. `scripts/lint/silent-warning-detector.mjs` has reported
// `catch-return-null` and `empty-catch` since slice A.2, but it was referenced
// ONLY by `package.json#test:ci`, and no workflow calls `test:ci`. So a leg that
// was red on arrival (41 + 59 = 100 violations over 781 files) could block
// nothing and could grow with nobody seeing it. This repo's answer to that shape
// is a ratchet — and a ratchet that has never been watched going red is prose,
// which is why every arm below drives the real gate rather than restating its
// comparison.
//
// WHAT EACH ARM PROVES, AND WHY IT IS WRITTEN THIS WAY
//   - Every arm spawns `.husky/peaks-gate.mjs silent-warning`: one measurement,
//     one comparison, the same `check()` and the same ceilings `repo` mode uses,
//     ~1s instead of the minutes `repo` mode costs. A test that re-implemented
//     `actual <= ceiling` locally would be asserting about itself, not about the
//     gate.
//   - The grace control writes the same swallows carrying a `// TODO(g2):` marker
//     and must go green again. The detector's node-extent suppression (slice
//     S5a) is inherited by this leg; were the leg to count marked sites, the
//     seeded ceiling would be unreachable and the ratchet unreadable.
//   - The fail-closed arm asks the gate about a path that does not exist, so the
//     detector scans nothing. The gate must REFUSE rather than print a `0` row —
//     the posture `notLinted` and the `REFUSING to measure` prettier branch
//     already take. Reporting a number it did not measure is the exact failure
//     this slice exists to close.
//   - AN INJECTED FIXTURE IS NEVER WRITTEN INTO THE REPO. It used to be
//     `src/__silent-warning-leg-fixture.ts`, untracked, because the detector
//     walks the filesystem while every other gate leg walks `git ls-files` — and
//     that asymmetry is what let an arm move the measured number without editing
//     anyone's source. It measured badly twice (QA, 2026-09-29): (a) a run
//     killed mid-flight LEAVES the file, and with it in the tree
//     `node .husky/peaks-gate.mjs repo` reads `✗ silent-warn return-null 42
//     (ceiling 41)` exit 1 — so a `peaks-gate-baseline.mjs` regeneration in that
//     window seeds a +1-poisoned ceiling, permanently; (b) two concurrent runs
//     collide on the one path (`EPERM` in `afterAll`, injections cross-deleted).
//     So the swallows now live in a temp directory OUTSIDE the repo, handed to
//     the gate as an explicit scan list — `mkdtempSync(tmpdir())`, the
//     convention at `tests/unit/hooks/gate-enforce-machine-local-shell.test.ts:84`.
//     The arms that need the gate's OWN default scope (the untouched run, the
//     detector-agreement arm) still get it: they measure, they do not inject.
//
// NO ARM PINS `measured == ceiling`. A freshly seeded ratchet sits AT its
// ceiling, so the first version of this file asserted the equality — and one
// unrelated swallow anywhere under `src/` then reddened the UNIT SUITE on top of
// the gate (measured: `expected '…42…' to contain 'ceilings held'`), as would a
// legitimate cleanup that lowered the count. The repo refuses that coupling
// where it states it: `tests/unit/lint/session-path-swallow-census.test.ts`
// declines a repo-wide number in a test because it "would be measuring their
// work", and 2878/1032 live only in `.peaks/lint/gate-baseline.json`. So the
// untouched arm asserts `actual <= ceiling`, the injection arms derive their +1
// from their own before/after measurement, and the count they inject against is
// read off the baseline artifact — where debt numbers belong — not typed here.
//
// Dimensions:
//   - render:      the two rows the leg prints, and what they carry
//   - behavior:    the green / RED verdict against the real ceilings
//   - integration: the real gate process, the real detector envelope, the real
//                  baseline artifact
//   - a11y:        the refusal text and the exit code of an unmeasurable leg

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/lint/silent-warning-gate-leg.test.ts',
  ['render', 'behavior', 'integration', 'a11y'],
  []
);

const REPO_ROOT = join(__dirname, '..', '..', '..');
const GATE = join('.husky', 'peaks-gate.mjs');
const BASELINE = join(REPO_ROOT, '.peaks', 'lint', 'gate-baseline.json');

/** The two table labels the leg prints, in `SW_RULES` order. */
const ROW_NULL = 'silent-warn return-null';
const ROW_EMPTY = 'silent-warn empty-catch';

/** Baseline keys carrying the two ceilings this leg ratchets. */
const KEY_NULL = 'silentWarningCatchReturnNull';
const KEY_EMPTY = 'silentWarningEmptyCatch';

/**
 * Per-run scratch, OUTSIDE the repo — see the header. `mkdtempSync` gives a
 * unique name, so two concurrent runs of this file scan and delete their own
 * fixtures and cannot collide.
 */
const SCRATCH = mkdtempSync(join(tmpdir(), 'silent-warning-gate-leg-'));

const MARKER = 'TODO(g2): a3 injection arm — grace-suppressed';

/** `count` swallowing catches; `marker` (when given) suppresses them all. */
function swallowSource(count: number, marker: string | null): string {
  const blocks: string[] = [];
  for (let i = 0; i < count; i++) {
    blocks.push(
      [
        `export function sweep${i}(path: string): void {`,
        '  try {',
        '    void path;',
        '  } catch {',
        ...(marker === null ? [] : [`    /* ${marker} */`]),
        '    /* best-effort */',
        '  }',
        '}'
      ].join('\n')
    );
  }
  return `${blocks.join('\n')}\n`;
}

function catchReturnNullSource(count: number): string {
  const blocks: string[] = [];
  for (let i = 0; i < count; i++) {
    blocks.push(
      [
        `export function read${i}(path: string): string | null {`,
        '  try {',
        '    return path;',
        '  } catch {',
        '    return null;',
        '  }',
        '}'
      ].join('\n')
    );
  }
  return `${blocks.join('\n')}\n`;
}

/** Write one fixture and return the path to hand the gate. */
function fixture(name: string, body: string): string {
  const path = join(SCRATCH, name);
  writeFileSync(path, body, 'utf8');
  return path;
}

type LegRun = { readonly code: number; readonly out: string };

/** Spawn the real gate in the mode `repo` mode's silent-warning legs run through. */
function runLeg(fileArgs: readonly string[] = []): LegRun {
  try {
    const out = execFileSync('node', [GATE, 'silent-warning', ...fileArgs], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

type Row = { readonly mark: string; readonly actual: number; readonly ceiling: number };

function rowFor(out: string, label: string): Row {
  const hit = new RegExp(`^\\s+(✓|✗)\\s+${label}\\s+(\\d+)\\s+\\(ceiling (\\d+)\\)`, 'm').exec(out);
  if (hit === null) throw new Error(`no '${label}' row in the leg output:\n${out}`);
  return { mark: hit[1] ?? '?', actual: Number(hit[2]), ceiling: Number(hit[3]) };
}

/** The detector's own envelope, read the same way the gate reads it. */
function detectorEnvelope(): { scannedFiles: number; byRule: Record<string, number> } {
  let raw = '';
  try {
    raw = execFileSync('node', ['scripts/lint/silent-warning-detector.mjs', '--json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
      windowsHide: true
    });
  } catch (err) {
    raw = (err as { stdout?: string }).stdout ?? '';
  }
  return JSON.parse(raw) as { scannedFiles: number; byRule: Record<string, number> };
}

function ceilings(): Record<string, unknown> {
  return (JSON.parse(readFileSync(BASELINE, 'utf8')) as { ceilings: Record<string, unknown> })
    .ceilings;
}

/**
 * The ceiling an injection arm counts against, read off the artifact instead of
 * typed in. It is the number the gate compares against in the SAME run, so
 * regenerating the baseline moves this test with it rather than against it.
 */
function ceilingOf(key: string): number {
  const value = ceilings()[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(
      `the baseline has no integer ceiling at "${key}": run node .husky/peaks-gate-baseline.mjs`
    );
  }
  return value;
}

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

beforeAll(() => {
  // Fail loudly rather than mid-suite: every injection arm's count comes from
  // these two keys, and a baseline without them means the ratchet is unseeded.
  ceilingOf(KEY_NULL);
  ceilingOf(KEY_EMPTY);
});

describe('Scenario: behavior — the verdict, against the real ceilings', () => {
  it('when the scanned scope is untouched, should hold both ceilings', () => {
    // given: the leg exactly as `repo` mode runs it, over the detector's own
    //        `src/` walk, with nothing injected anywhere
    // when: the gate compares what it measured to what the baseline allows
    // then: exit 0, both rows ✓, and the measured count AT OR BELOW the ceiling.
    //       NOT equal to it — see the header: the equality made one unrelated
    //       swallow (or one unrelated cleanup) redden this suite as well as the
    //       gate, which is two signals for one fact.
    const run = runLeg();
    expect(run.out, run.out).toContain('ceilings held');
    expect(run.code).toBe(0);
    for (const label of [ROW_NULL, ROW_EMPTY]) {
      const row = rowFor(run.out, label);
      expect(row.mark, run.out).toBe('✓');
      expect(row.actual, run.out).toBeLessThanOrEqual(row.ceiling);
    }
  });

  it('when one unmarked catch {} joins the scanned scope, should turn the leg RED', () => {
    // given: the leg over a fixture carrying EXACTLY the ceiling's worth of
    //        unmarked empty catches — held (that is the before measurement)
    // when: one more unmarked `catch {}` is what the leg scans
    // then: the row moves by exactly one over what was just measured, the mark
    //       flips, and the breach names the leg, the number and the ceiling
    const atCeiling = fixture('empty-at-ceiling.ts', swallowSource(ceilingOf(KEY_EMPTY), null));
    const before = runLeg([atCeiling]);
    expect(rowFor(before.out, ROW_EMPTY).mark, before.out).toBe('✓');
    expect(before.code, before.out).toBe(0);

    const breach = fixture('empty-breach.ts', swallowSource(ceilingOf(KEY_EMPTY) + 1, null));
    const after = runLeg([breach]);
    const beforeRow = rowFor(before.out, ROW_EMPTY);
    const afterRow = rowFor(after.out, ROW_EMPTY);
    expect(afterRow.actual, after.out).toBe(beforeRow.actual + 1);
    expect(afterRow.mark, after.out).toBe('✗');
    expect(after.out, after.out).toContain(
      `${ROW_EMPTY}: ${afterRow.actual} > ceiling ${afterRow.ceiling}`
    );
    expect(after.code).toBe(1);
  });

  it('when those same catches carry the grace marker, should hold the ceiling again', () => {
    // given: the BREACHING file — same rule, same count, one more than allowed
    // when: the leg re-measures the same shape with a `// TODO(g2):` marker on
    //       every construct
    // then: suppression survives the leg, the row reads 0, and the leg is green
    const marked = fixture('empty-grace.ts', swallowSource(ceilingOf(KEY_EMPTY) + 1, MARKER));
    const run = runLeg([marked]);
    const empty = rowFor(run.out, ROW_EMPTY);
    expect(empty.actual, run.out).toBe(0);
    expect(empty.mark, run.out).toBe('✓');
    expect(run.code, run.out).toBe(0);
  });

  it('when one unmarked catch returns null instead, should breach the other leg', () => {
    // given / when: the second rule's shape, same before/after construction
    // then: `catch-return-null` moves by one over what was measured and is the
    //       leg that fails
    const atCeiling = fixture('null-at-ceiling.ts', catchReturnNullSource(ceilingOf(KEY_NULL)));
    const before = runLeg([atCeiling]);
    expect(rowFor(before.out, ROW_NULL).mark, before.out).toBe('✓');
    expect(before.code, before.out).toBe(0);

    const breach = fixture('null-breach.ts', catchReturnNullSource(ceilingOf(KEY_NULL) + 1));
    const after = runLeg([breach]);
    const nul = rowFor(after.out, ROW_NULL);
    expect(nul.actual, after.out).toBe(rowFor(before.out, ROW_NULL).actual + 1);
    expect(nul.mark, after.out).toBe('✗');
    expect(after.out).toContain(`${ROW_NULL}: ${nul.actual} > ceiling ${nul.ceiling} (+1)`);
    expect(after.code).toBe(1);
  });
});

describe('Scenario: render — the two rows and what they carry', () => {
  it('when the leg is scoped to one scratch file, should print both rules with their counts', () => {
    // given: three unmarked empty catches, outside the repo, passed as an
    //        explicit path. A scoped run is NOT the enforcement run — the
    //        ceilings are whole-scope numbers, so the rows here read as held.
    //        What this arm pins is the row: mark, label, measured count, ceiling.
    // when: the gate prints its table for that file alone
    // then: empty-catch counts 3, catch-return-null counts 0, and the ceiling it
    //       carries is the artifact's
    const scratch = fixture('render-unmarked.ts', swallowSource(3, null));
    const run = runLeg([scratch]);
    expect(rowFor(run.out, ROW_EMPTY).actual, run.out).toBe(3);
    expect(rowFor(run.out, ROW_NULL).actual, run.out).toBe(0);
    expect(run.out).toContain(`(ceiling ${ceilingOf(KEY_EMPTY)})`);
  });

  it('when the scoped scratch file carries the grace marker, should render both rules at zero', () => {
    // given: the same three swallows, each line-spanned by a `TODO(g2)` marker
    // when: the leg is scoped to that file
    // then: suppression survives the leg — the rows are 0, not 3
    const scratch = fixture('render-marked.ts', swallowSource(3, MARKER));
    const run = runLeg([scratch]);
    expect(rowFor(run.out, ROW_EMPTY).actual, run.out).toBe(0);
    expect(rowFor(run.out, ROW_NULL).actual, run.out).toBe(0);
  });
});

describe("Scenario: integration — the number is the detector's, the ceiling is the artifact's", () => {
  it("when the leg prints a count, should match the detector's own --json envelope", () => {
    // given: the detector run directly, the way `pnpm test:ci` used to run it
    // when: both are asked for the same two rules over the same default scope
    // then: the gate reports the detector's numbers, not a literal
    const env = detectorEnvelope();
    const run = runLeg();
    expect(rowFor(run.out, ROW_NULL).actual).toBe(env.byRule['catch-return-null'] ?? 0);
    expect(rowFor(run.out, ROW_EMPTY).actual).toBe(env.byRule['empty-catch'] ?? 0);
    expect(env.scannedFiles).toBeGreaterThan(0);
  });

  it('when the leg prints a ceiling, should read it off the regenerated baseline', () => {
    // given: `.peaks/lint/gate-baseline.json`, written by the regenerator from
    //        this same detector
    // when: the leg compares
    // then: the two ceiling keys exist and are the ceilings the leg printed
    const artifact = ceilings();
    for (const key of [KEY_NULL, KEY_EMPTY]) {
      expect(Number.isInteger(artifact[key]), `${key} is not an integer ceiling`).toBe(true);
    }
    const run = runLeg();
    expect(rowFor(run.out, ROW_NULL).ceiling).toBe(artifact[KEY_NULL]);
    expect(rowFor(run.out, ROW_EMPTY).ceiling).toBe(artifact[KEY_EMPTY]);
  });
});

describe('Scenario: a11y — an unmeasurable leg refuses, in words', () => {
  it('when the detector scans nothing, should exit 1 refusing to measure and print no zero row', () => {
    // given: a path the detector cannot open, so `scannedFiles` is 0
    // when: the leg is asked for its numbers anyway
    // then: it REFUSES — exit 1, the refusal names the command to run, and there
    //       is no `0` row and no "held" line to mistake for a pass
    const run = runLeg([join(SCRATCH, 'does-not-exist.ts')]);
    expect(run.code).toBe(1);
    expect(run.out).toContain('REFUSING to measure');
    expect(run.out).toContain('not a zero');
    expect(run.out).not.toMatch(/silent-warn (return-null|empty-catch)/);
    expect(run.out).not.toContain('ceilings held');
  });
});
