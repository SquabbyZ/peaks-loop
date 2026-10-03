// tests/unit/lint/file-size-excess-gate-leg.test.ts
//
// Slice rid 2026-10-01-file-size-excess-row — the injection control for the
// thirteenth ceiling row, `fileSizeExcessLines`.
//
// WHY THIS ROW EXISTS (measured, C wave 6). `fileSizeOverCap` counts FILES over the
// 300/500 raw-line cap, so the LINES over that cap could move freely underneath it:
// wave 6 hoisted helpers into files that were already over cap, the repo's excess
// went 60,204 → 60,271 (+67), `fileSizeOverCap` held at 166, and `gate repo` exited
// 0. The figure was printed in the row's scope note and enforced by nothing. This
// file makes it a ceiling: seeded from the census envelope, ratcheted beside
// `fileSizeOverCap` off the SAME census invocation, RED on one more line than the
// recorded ceiling.
//
// WHAT EACH ARM PROVES, AND WHY IT IS WRITTEN THIS WAY
//   - Every arm spawns `.husky/peaks-gate.mjs file-size`: the same leg `repo` mode
//     runs, the same ceilings, ~2s instead of the ~1m45s `repo` mode costs. A test
//     that re-implemented `actual <= ceiling` locally would be asserting about
//     itself, not about the gate — the reason that mode exists, inherited verbatim
//     from `tests/unit/lint/file-size-gate-leg.test.ts`.
//   - THE +1 ARM IS THE POINT. A ratchet that has never been watched going red is
//     prose. It hands the leg exactly the ceiling's worth of excess lines (the
//     before measurement, held), then ONE MORE LINE, and requires the row to flip
//     and the process to exit 1. Because this row is a SUM and not a count, the
//     fixture is one file sized `cap + ceiling` lines, and the breach is that same
//     file one line longer.
//   - THE LOWERED ARM STAYS GREEN. No arm pins `measured == ceiling`: a freshly
//     seeded row sits at its ceiling today, and the split campaign that follows must
//     be able to descend it. (The discipline
//     `tests/unit/lint/silent-warning-gate-leg.test.ts` records.)
//   - BOTH ROWS DIE TOGETHER, BY CONSTRUCTION. The excess row shares the census
//     invocation with `fileSizeOverCap` deliberately, so a census that cannot run —
//     or a ceiling that was never seeded — must take BOTH rows down: refusal text,
//     neither row printed, exit 1. One arm proves the behaviour through the real
//     process, one proves the mechanism in-process against the shared leg module
//     (`missingFileSizeCeilings`), and one pins that the gate has exactly ONE census
//     call site feeding both `check` calls. The alternative — a second spawn with
//     its own fail-closed arm — is finding F5 of the cap-unify review, already
//     flagged once in this repo.
//   - NOTHING IS WRITTEN INTO THE REPO. The fixtures live in `mkdtempSync(tmpdir())`
//     and reach the leg as an explicit path list, so a killed run cannot leave an
//     over-cap file behind and poison the next regeneration with a +1 ceiling
//     (measured failure mode, QA 2026-09-29).
//   - NO CEILING IS TYPED HERE. Every arm derives its fixture size from the
//     published artifact and the policy's own cap, so a re-seed moves the test with
//     it instead of breaking it.
//
// Dimensions:
//   - render:      the row the leg prints, and the scope note under it
//   - behavior:    held / RED / lowered / refused, against the real ceiling
//   - integration: the real gate process, the real census envelope, the real
//                  baseline artifact, and a third independent filesystem walk
//   - a11y:        the exit codes and the breach text a commit sees

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  BASELINE_PATH,
  REPO_ROOT,
  gateModuleText,
  generatorModuleTextUnder,
  fileSizeModuleText,
  overCapFromWalk,
  runCensus
} from '../standards/_file-size-cap-scan.js';
import { FILE_SIZE_CAP_DEFAULT } from '../../../src/services/scan/file-size-policy.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

declareDimensions(
  'tests/unit/lint/file-size-excess-gate-leg.test.ts',
  ['render', 'behavior', 'integration', 'a11y'],
  []
);

const GATE = join('.husky', 'peaks-gate.mjs');
const SHARED_LEG = join('.husky', 'peaks-gate-file-size.mjs');
const OVER_CAP_ROW = 'file-size over cap';
const OVER_CAP_KEY = 'fileSizeOverCap';
const ROW = 'file-size excess lines';
const CEILING_KEY = 'fileSizeExcessLines';
const CONTROL_ARM = '--control-arm';

const SCRATCH = mkdtempSync(join(tmpdir(), 'peaks-file-size-excess-leg-'));

type LegRun = { readonly code: number; readonly out: string };

function runLeg(fileArgs: readonly string[] = [], controlArm = false): LegRun {
  const argv = controlArm ? [CONTROL_ARM, ...fileArgs] : fileArgs;
  try {
    const out = execFileSync('node', [GATE, 'file-size', ...argv], {
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

/** The published artifact's ceiling block — the gate's own input, not a copy. */
function publishedCeilings(): Record<string, unknown> {
  return (JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as { ceilings: Record<string, unknown> })
    .ceilings;
}

/** The ceiling the gate compares against, read off the artifact — never typed. */
function publishedCeiling(): number {
  const value = publishedCeilings()[CEILING_KEY];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(
      `the baseline has no integer ceiling at "${CEILING_KEY}": run node .husky/peaks-gate-baseline.mjs`
    );
  }
  return value;
}

function rowFor(out: string, label: string): { mark: string; actual: number; ceiling: number } {
  const hit = new RegExp(`^\\s+(✓|✗)\\s+${label}\\s+(\\d+)\\s+\\(ceiling (\\d+)\\)`, 'm').exec(out);
  if (hit === null) throw new Error(`no '${label}' row in the leg output:\n${out}`);
  return { mark: hit[1] ?? '?', actual: Number(hit[2]), ceiling: Number(hit[3]) };
}

/**
 * A file in OS tmp whose excess over the cap the census applies to it is exactly
 * `excess` lines. A path outside the policy's four directories keeps the default
 * cap, so `cap + excess` raw lines is `excess` lines over it — and the breach arm
 * only has to add one line to the same fixture.
 */
function excessFixture(excess: number): string {
  const lines = FILE_SIZE_CAP_DEFAULT + excess;
  const path = join(SCRATCH, `excess-${String(lines)}.ts`);
  writeFileSync(path, Array.from({ length: lines }, () => 'x').join('\n'), 'utf8');
  return path;
}

/** The part of the shared leg the in-process arms call. */
type FileSizeLegModule = {
  FS_CEILING_KEY: string;
  FS_EXCESS_CEILING_KEY: string;
  FS_EXCESS_ROW_LABEL: string;
  // PROPERTY spellings, not method signatures (rid `2026-10-03-w10-rescope-a`
  // repair 1): the arms below DESTRUCTURE these off the loaded module, and
  // `@typescript-eslint/unbound-method` flags an unbound reference to anything
  // TYPED as a method — the `.mjs` exports are plain functions, so the property
  // type is both the honest shape and what keeps the five destructured sites clean.
  missingFileSizeCeilings: (ceilings: Record<string, unknown>) => string | null;
  partitionCensusOverCap: (env: unknown) => {
    gated: { overCap: number; excessLines: number };
    shadow: { overCap: number; excessLines: number };
  };
};

async function loadLegModule(): Promise<FileSizeLegModule> {
  return (await import(pathToFileURL(join(REPO_ROOT, SHARED_LEG)).href)) as FileSizeLegModule;
}

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

describe('Scenario: render — the row the leg prints', () => {
  it(
    'when the census runs whole-scope, should print an excess-lines row with its own ceiling beside the over-cap row',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const env = runCensus();
      const { partitionCensusOverCap } = await loadLegModule();
      // The rows speak for the ENFORCED scope (rid `2026-10-03-w10-rescope-a`):
      // the same envelope, cut by the shared partition. The universe totals stay
      // in the scope note below, which still names what the census counted.
      const gated = partitionCensusOverCap(env).gated;
      const run = runLeg();
      expect(run.code, run.out).toBe(0);
      const row = rowFor(run.out, ROW);
      expect(row.mark, run.out).toBe('✓');
      expect(row.actual, run.out).toBe(gated.excessLines);
      expect(row.ceiling, run.out).toBe(publishedCeiling());
      // Two rows, ONE census: the scope note under them is shared, and it is what
      // makes each number checkable from the log alone.
      expect(rowFor(run.out, OVER_CAP_ROW).actual, run.out).toBe(gated.overCap);
      expect(run.out).toContain('scope note');
      expect(run.out).toContain(env.convention);
      expect(run.out).toContain(`against caps ${env.caps.defaultCap}/${env.caps.testsCap}`);
      expect(run.out).toContain(`${env.scope.countedFiles} file(s)`);
      for (const [dir, totals] of Object.entries(env.byDir)) {
        expect(run.out, dir).toContain(`${dir} ${totals.files}`);
      }
    }
  );
});

describe('Scenario: behavior — the row refuses to rise', () => {
  it(
    'when the tree is untouched, should hold the ceiling and exit 0',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const run = runLeg();
      expect(run.code, run.out).toBe(0);
      const row = rowFor(run.out, ROW);
      expect(row.mark, run.out).toBe('✓');
      expect(row.actual, run.out).toBeLessThanOrEqual(row.ceiling);
      expect(run.out).toContain('file-size ceiling held');
    }
  );

  it(
    'when one more excess line than the ceiling is over cap, should turn the row RED and exit 1',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const ceiling = publishedCeiling();
      // given: exactly the ceiling's worth of excess lines — the before
      //        measurement, which must still be held.
      const held = runLeg([excessFixture(ceiling)], true);
      expect(held.code, held.out).toBe(0);
      expect(rowFor(held.out, ROW).actual, held.out).toBe(ceiling);
      expect(rowFor(held.out, ROW).mark, held.out).toBe('✓');

      // when: that same file one line longer — one excess line more than the repo
      //        is allowed to carry.
      const breached = runLeg([excessFixture(ceiling + 1)], true);

      // then: the row flips, the breach names the delta, and the exit code is the
      //       one that blocks the commit.
      expect(breached.code, breached.out).toBe(1);
      expect(rowFor(breached.out, ROW).mark, breached.out).toBe('✗');
      expect(breached.out).toContain(`${ROW}: ${ceiling + 1} > ceiling ${ceiling} (+1)`);
      // THE WAVE-6 SHADE, INVERTED. This run's file COUNT is one, far under the
      // over-cap ceiling, so `fileSizeOverCap` holds while the excess row breaks —
      // the two quantities wave 6 moved in opposite directions, now watched apart.
      expect(rowFor(breached.out, OVER_CAP_ROW).mark, breached.out).toBe('✓');
    }
  );

  it(
    'when the excess is one line under the ceiling, should stay GREEN and exit 0',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // The descent this row exists to force: lowering must be green, so a split
      // can pay the row back without a re-seed.
      const run = runLeg([excessFixture(publishedCeiling() - 1)], true);
      expect(run.code, run.out).toBe(0);
      expect(rowFor(run.out, ROW).mark, run.out).toBe('✓');
    }
  );
});

describe('Scenario: behavior — a census failure takes BOTH rows down', () => {
  it(
    'when the census cannot run, should refuse, print neither row, and exit 1',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const run = runLeg([join(SCRATCH, 'never-written.ts')], true);
      expect(run.code, run.out).toBe(1);
      expect(run.out).toContain('REFUSING to measure the file-size leg');
      expect(run.out).toContain('gate FAILURE, not a zero');
      expect(run.out).not.toMatch(/[✓✗] file-size over cap/);
      expect(run.out).not.toMatch(/[✓✗] file-size excess lines/);
      expect(run.out).not.toContain('ceiling held');
      // Evidence before verdict is the leg's contract — but only for a run that got
      // evidence. A census that never ran invents no scope note.
      expect(run.out).not.toContain('scope note');
    }
  );

  it(
    'when the baseline has no ceiling for the new key, should refuse the whole leg and name it',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // THE MECHANISM BEHIND THE ARM ABOVE. The leg takes both rows down because ONE
      // guard decides whether either may speak — and that guard now has to know
      // about both keys. Reaching this through the real process would mean deleting
      // a ceiling from the published artifact, which a test may not do to make
      // itself pass, so it is asserted against the module the gate calls.
      const module = await loadLegModule();
      expect(module.FS_EXCESS_CEILING_KEY).toBe(CEILING_KEY);
      expect(module.FS_EXCESS_ROW_LABEL).toBe(ROW);

      const seeded: Record<string, unknown> = { [OVER_CAP_KEY]: 166 };
      const refusal = module.missingFileSizeCeilings(seeded);
      expect(refusal, JSON.stringify(seeded)).toContain('REFUSING to measure the file-size leg');
      expect(refusal ?? '').toContain(CEILING_KEY);
      expect(refusal ?? '').toContain('peaks-gate-baseline.mjs');

      // Both ceilings present → the guard stays silent; it refuses a missing
      // number, not a leg that has one.
      expect(module.missingFileSizeCeilings(publishedCeilings())).toBeNull();
    }
  );
});

describe('Scenario: integration — walk == tool == artifact for the new row', () => {
  it(
    'stores the number the census measured, which a third independent walk agrees with',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const env = runCensus();
      const { partitionCensusOverCap } = await loadLegModule();
      // The ceiling ratchets the ENFORCED part of the census universe (rid
      // `2026-10-03-w10-rescope-a`); the walk is cut by the same rule.
      const gated = partitionCensusOverCap(env).gated;
      const { isLintScoped } = (await import(
        pathToFileURL(join(REPO_ROOT, '.husky', 'lint-scope.mjs')).href
      )) as { isLintScoped: (file: string) => boolean };
      expect(env.scope.source).toBe('git ls-files <policy dirs>');
      expect(publishedCeiling()).toBe(gated.excessLines);
      // The same sum from a walk that shares no enumeration with the census and no
      // code path with the generator: the ceiling is checkable, not asserted.
      const fromWalk = overCapFromWalk(REPO_ROOT).reduce(
        (sum, entry) =>
          isLintScoped(entry.file) ? sum + (entry.lines - entry.cap) : sum,
        0
      );
      expect(fromWalk).toBe(gated.excessLines);
    }
  );

  it('seeds the row from the envelope and never from a literal', () => {
    const generator = generatorModuleTextUnder(REPO_ROOT);
    expect(generator).toContain('fileSizeExcessLines: size.env.excessLines');
    // The rule `phantomRules` and the silent-warning rows obey: a typed number
    // freezes the ceiling in place of the measurement.
    expect(generator).not.toMatch(/fileSizeExcessLines:\s*\d/);
    expect(generator).toContain('measureFileSizeOverCap(');
  });

  it('enforces both rows from ONE census invocation, in the whole-repo mode too', () => {
    // POOLED OVER THE GATE'S MODULE SET (rid 2026-10-02-wave9-gate-entry-split): the
    // leg that reads the census is `.husky/gate/legs.mjs` and its caller is
    // `.husky/gate/repo.mjs`, so "one invocation feeding both checks" is a property
    // of the set. The set is walked, not listed; the plant/inverse arms that prove the
    // pool can fail live in `file-size-cap.test.ts` and `file-size-gate-leg.test.ts`.
    const gate = gateModuleText();
    // One spawn feeding both checks: a census failure therefore takes both down.
    expect(gate.match(/measureFileSizeOverCap\(/g) ?? []).toHaveLength(1);
    expect(gate).toContain('check(FS_ROW_LABEL, gated.overCap');
    expect(gate).toContain('check(FS_EXCESS_ROW_LABEL, gated.excessLines');
    expect(gate).toContain('missingFileSizeCeilings(ceilings)');
    // And `repo` mode runs this same leg, not a copy of it.
    expect(gate).toMatch(/fileSizeLeg\(check, c, \[\]\)/);
    // POOLED over the walked file-size module set (rid `2026-10-02-wave9-file-size-split`):
    // the ceiling key and label moved into `.husky/file-size/constants.mjs`, so the pin
    // reads the SET, not the entry alone — the same posture `gateModuleText` takes above.
    const shared = fileSizeModuleText(REPO_ROOT);
    expect(shared).toContain(CEILING_KEY);
    expect(shared).toContain(ROW);
  });
});

describe('Scenario: a11y — what a breach says to the human who hits it', () => {
  it(
    'when the row breaks, should name the row, the delta, and the do-not-raise instruction',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const run = runLeg([excessFixture(publishedCeiling() + 1)], true);
      expect(run.code, run.out).toBe(1);
      expect(run.out).toContain(
        `${ROW}: ${publishedCeiling() + 1} > ceiling ${publishedCeiling()}`
      );
      expect(run.out).toContain('(+1)');
      expect(run.out).toContain('CONTROL ARM');
      expect(run.out).toContain('do not raise the ceiling');
    }
  );
});
