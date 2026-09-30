// tests/unit/lint/file-size-gate-leg.test.ts
//
// Slice rid 2026-09-30-cap-unify-01 — the injection control for the
// `fileSizeOverCap` ratchet leg.
//
// WHAT EACH ARM PROVES, AND WHY IT IS WRITTEN THIS WAY
//   - Every arm spawns `.husky/peaks-gate.mjs file-size`: one measurement, one
//     `check`, the same ceiling `repo` mode ratchets, ~1s instead of the 3m06s
//     `repo` mode costs. A test that re-implemented `actual <= ceiling` locally
//     would be asserting about itself, not about the gate — the reason the
//     `silent-warning` mode exists, inherited verbatim.
//   - THE +1 ARM IS THE POINT. A ratchet that has never been watched going red is
//     prose. It hands the leg exactly the ceiling's worth of over-cap files (the
//     before measurement, held), then one more, and requires the row to flip and
//     the process to exit 1. That is the goal's "the new row refuses to grow".
//   - NO ARM PINS `measured == ceiling`. A freshly seeded row sits AT its ceiling
//     today, and the first split that lands lowers it; the untouched arm therefore
//     asserts `<=`, and the injection arm derives its count from the artifact and
//     its own before/after measurement — the discipline
//     `tests/unit/lint/silent-warning-gate-leg.test.ts` records.
//   - NOTHING IS WRITTEN INTO THE REPO. The fixtures live in `mkdtempSync(tmpdir())`
//     and are handed to the leg as an explicit path list, so a killed run cannot
//     leave an over-cap file behind and poison the next regeneration with a +1
//     ceiling (measured failure mode, QA 2026-09-29).
//   - THE FAIL-CLOSED ARM asks the leg to count a file that is not there. It must
//     REFUSE with exit 1 and print no row — never a `0`, because `0` is what "the
//     whole tree is under the cap" looks like.
//
// Dimensions:
//   - render:      the row the leg prints, and the refusal text
//   - behavior:    held / RED / refused, against the real published ceiling
//   - integration: the real gate process, the real census envelope, the real
//                  baseline artifact
//   - a11y:        the exit codes a commit sees (0 held, 1 breach, 1 refusal)

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  CENSUS_TOOL_PATH,
  REPO_ROOT,
  overCapFixture,
  runCensus
} from '../standards/_file-size-cap-scan.js';
import { FILE_SIZE_CAP_DEFAULT } from '../../../src/services/scan/file-size-policy.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

declareDimensions(
  'tests/unit/lint/file-size-gate-leg.test.ts',
  ['render', 'behavior', 'integration', 'a11y'],
  []
);

const GATE = join('.husky', 'peaks-gate.mjs');
const ROW = 'file-size over cap';
const CEILING_KEY = 'fileSizeOverCap';

const SCRATCH = mkdtempSync(join(tmpdir(), 'peaks-file-size-gate-leg-'));

/** The ceiling the gate itself compares against, read off the artifact. */
function publishedCeiling(): number {
  const ceilings = (
    JSON.parse(readFileSync(join(REPO_ROOT, '.peaks', 'lint', 'gate-baseline.json'), 'utf8')) as {
      ceilings: Record<string, unknown>;
    }
  ).ceilings;
  const value = ceilings[CEILING_KEY];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(
      `the baseline has no integer ceiling at "${CEILING_KEY}": run node .husky/peaks-gate-baseline.mjs`
    );
  }
  return value;
}

type LegRun = { readonly code: number; readonly out: string };

function runLeg(fileArgs: readonly string[] = []): LegRun {
  try {
    const out = execFileSync('node', [GATE, 'file-size', ...fileArgs], {
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

function rowFor(out: string): { mark: string; actual: number; ceiling: number } {
  const hit = new RegExp(`^\\s+(✓|✗)\\s+${ROW}\\s+(\\d+)\\s+\\(ceiling (\\d+)\\)`, 'm').exec(out);
  if (hit === null) throw new Error(`no '${ROW}' row in the leg output:\n${out}`);
  return { mark: hit[1] ?? '?', actual: Number(hit[2]), ceiling: Number(hit[3]) };
}

/** `count` over-cap files in OS tmp, as the leg's explicit path list. */
function overCapPaths(count: number): string[] {
  const paths: string[] = [];
  for (let i = 0; i < count; i++) {
    const path = join(SCRATCH, `over-${String(i).padStart(4, '0')}.ts`);
    writeFileSync(path, overCapFixture(FILE_SIZE_CAP_DEFAULT), 'utf8');
    paths.push(path);
  }
  return paths;
}

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

describe('Scenario: behavior — the verdict, against the real ceiling', () => {
  it(
    'when the tree is untouched, should hold the ceiling and exit 0',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const run = runLeg();
      expect(run.out, run.out).toContain('file-size ceiling held');
      expect(run.code).toBe(0);
      const row = rowFor(run.out);
      expect(row.mark, run.out).toBe('✓');
      expect(row.actual, run.out).toBeLessThanOrEqual(row.ceiling);
    }
  );

  it(
    'when one more file than the ceiling exceeds the cap, should turn the leg RED and exit 1',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const ceiling = publishedCeiling();
      // given: exactly the ceiling's worth of over-cap files — the before
      //        measurement, which must still be held.
      const held = runLeg(overCapPaths(ceiling));
      expect(held.code, held.out).toBe(0);
      expect(rowFor(held.out).actual).toBe(ceiling);

      // when: one more file crosses the cap
      const breached = runLeg(overCapPaths(ceiling + 1));

      // then: the row flips, the breach names the delta, and the exit code is the
      //       one that blocks the commit.
      expect(breached.code).toBe(1);
      expect(rowFor(breached.out).mark).toBe('✗');
      expect(breached.out).toContain(`${ROW}: ${ceiling + 1} > ceiling ${ceiling} (+1)`);
      expect(breached.out).toContain('file-size ratchet breached');
      expect(breached.out).toContain('do not raise the ceiling');
    }
  );
});

describe('Scenario: integration — the leg measures the census, not its own idea', () => {
  it(
    'when untouched, the row equals an independent run of the census tool',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const run = runLeg();
      expect(rowFor(run.out).actual).toBe(runCensus().overCap);
      expect(rowFor(run.out).ceiling).toBe(publishedCeiling());
    }
  );

  it('is wired into both the whole-repo mode and the mode this test spawns', () => {
    // A leg nothing calls enforces nothing — the same wiring-first assertion
    // `lint-file-list-parity.test.ts` makes for `pnpm lint`.
    const gate = readFileSync(join(REPO_ROOT, GATE), 'utf8');
    expect(gate).toMatch(/fileSizeLeg\(check, c, \[\]\)/);
    expect(gate).toMatch(/mode === 'file-size'/);
    const generator = readFileSync(join(REPO_ROOT, '.husky', 'peaks-gate-baseline.mjs'), 'utf8');
    expect(generator).toContain('fileSizeOverCap: size.env.overCap');
    expect(generator).toContain(CENSUS_TOOL_PATH);
  });
});

describe('Scenario: a11y — a census that cannot run is a failure, never a zero', () => {
  it(
    'when handed a path that does not exist, should refuse with exit 1 and print no row',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const run = runLeg([join(SCRATCH, 'not-there.ts')]);
      expect(run.code).toBe(1);
      expect(run.out).toContain('REFUSING to measure the file-size leg');
      expect(run.out).toContain('gate FAILURE, not a zero');
      expect(run.out).not.toContain(`✓ ${ROW}`);
      expect(run.out).not.toContain('ceiling held');
    }
  );

  it('names the leg, the count and the ceiling in the row it prints', () => {
    const run = runLeg();
    const row = rowFor(run.out);
    expect(run.out).toContain(ROW);
    expect(row.ceiling).toBe(publishedCeiling());
    // The scope note is what makes the number checkable from the log alone.
    expect(run.out).toContain('git ls-files <policy dirs>');
    expect(run.out).toContain('excess lines');
  });
});
