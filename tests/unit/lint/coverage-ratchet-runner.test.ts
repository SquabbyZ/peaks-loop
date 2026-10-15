// tests/unit/lint/coverage-ratchet-runner.test.ts
//
// The coverage FLOOR's runner, driven as a real child process.
//
// WHY THIS FILE EXISTS APART FROM `coverage-ratchet.test.ts`. The arms here need a REAL process —
// real exit codes, real stdout, a real `git show` — and together with the pure battery they crossed
// the 500-line `tests/**` cap, which is the cap's own remedy rather than a preference. The harness
// both files share is `_coverage-ratchet-fixture.ts`; nothing about the runner is stubbed here.
//
// WHAT ONLY THIS FILE CAN SHOW. The pure arms prove the DECISION TABLE refuses a subset report and a
// lowered floor. Only a spawned process shows that the runner WIRES those decisions to an exit code,
// and that the writer cannot be moved by a report it did not measure. Arms U and AD are the
// regression arms for the hole a review found: a one-row report at 99 % read `HELD` and exited 0, and
// `--raise` on that same report WROTE `linesPct 47 -> 97.32`.
//
// THE ANCHOR ARM BUILDS A REAL GIT REPOSITORY (AF), because `readHeadFloor()` reads the previous
// floor out of HEAD and there is no way to have a HEAD that holds one without one. It lives under
// `mkdtempSync(join(tmpdir(), …))`, never in this working tree, and is removed in its own `finally`.
//
// Dimensions covered:
//   - render:      the population line's shape (a COUNT, never an array) on green and on refusal
//   - behavior:    the account check and the writer guard, as exit codes
//   - integration: the real `.peaks/lint/` artifact, the real runner, and a real `git show`
//   - a11y:        the operator-facing sentences and the process exit codes

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import {
  FLOOR_ABS,
  FLOOR_REL,
  MODULES_REL,
  RATCHET_REL,
  REPO_ROOT,
  fixtureReport,
  fullReport,
  ratchet,
  trackedFloor,
  trackedSourceKeys,
  withReport
} from './_coverage-ratchet-fixture.js';

declareDimensions(
  'tests/unit/lint/coverage-ratchet-runner.test.ts',
  ['render', 'behavior', 'integration', 'a11y'],
  []
);

let trackedFloorPct = 0;
let trackedBytes = '';
let population: string[] = [];
let srcKeys: string[] = [];

beforeAll(() => {
  ({ linesPct: trackedFloorPct, bytes: trackedBytes } = trackedFloor());
  population = trackedSourceKeys();
  srcKeys = population.slice(0, 2);
  expect(population.length).toBeGreaterThan(100);
  expect(srcKeys.length).toBe(2);
});

describe('Scenario: integration — the real runner trips on a full-population report', () => {
  it(
    'R: a full-population report BELOW the floor exits 1 with BREACHED and the population line',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      withReport(fullReport(trackedFloorPct - 1, population), (path) => {
        const run = ratchet(['--report', path]);
        expect(run.code, run.out).toBe(1);
        expect(run.out).toContain('BREACHED');
        expect(run.out).toContain(String(trackedFloorPct));
        expect(run.out).toContain(`${population.length} file(s) under src/**`);
      });
    }
  );

  it(
    'S: a full-population report AT or ABOVE the floor exits 0, naming the margin',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      withReport(fullReport(trackedFloorPct + 1, population), (path) => {
        const run = ratchet(['--report', path]);
        expect(run.code, run.out).toBe(0);
        expect(run.out).toContain('HELD');
        expect(run.out).toContain(`${population.length} file(s) under src/**`);
      });
    }
  );

  it(
    'T: an absent report refuses at exit 1 and still prints the measured population line',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const run = ratchet([
        '--report',
        join(tmpdir(), 'peaks-coverage-floor-absent', 'coverage-summary.json')
      ]);
      expect(run.code, run.out).toBe(1);
      expect(run.out).toContain('REFUSING');
      expect(run.out).toContain('0 file(s) under');
    }
  );
});

describe('Scenario: behavior and a11y — a subset report cannot pass and cannot move the floor', () => {
  it(
    'U: a SUBSET report at 99% is REFUSED, not read as HELD — the hole a review found',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // This is the shape the first draft READ AS GREEN: one row, a high percentage, exit 0.
      withReport(fixtureReport(99, srcKeys), (path) => {
        const run = ratchet(['--report', path]);
        expect(run.code, run.out).toBe(1);
        expect(run.out).toContain('SUBSET');
        expect(run.out).not.toContain('HELD');
      });
    }
  );

  it(
    'AD: --raise from a SUBSET report is refused too, so the writer cannot move the floor',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // Without the account check this WROTE: a one-row 97.82 % report moved linesPct 47 -> 97.32.
      withReport(fixtureReport(99, srcKeys), (path) => {
        const run = ratchet(['--raise', '--report', path]);
        expect(run.code, run.out).toBe(1);
        expect(run.out).toContain('SUBSET');
      });
      expect(readFileSync(FLOOR_ABS, 'utf8')).toBe(trackedBytes);
    }
  );

  it(
    'AE: an unknown argument is a usage error (exit 2), not a silent pass',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const run = ratchet(['--nonsense']);
      expect(run.code, run.out).toBe(2);
      expect(run.out).toContain('usage:');
    }
  );
});

describe('Scenario: integration — the HEAD anchor refuses a lowered floor in a real repository', () => {
  it(
    'AF: a working floor below HEAD is refused, and --lower-floor is what gets past it',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const root = mkdtempSync(join(tmpdir(), 'peaks-coverage-floor-anchor-'));
      try {
        const git = (...args: readonly string[]): void => {
          const r = spawnSync('git', [...args], { cwd: root, windowsHide: true, encoding: 'utf8' });
          if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
        };
        mkdirSync(join(root, '.peaks', 'lint'), { recursive: true });
        cpSync(join(REPO_ROOT, RATCHET_REL), join(root, RATCHET_REL));
        cpSync(join(REPO_ROOT, MODULES_REL), join(root, MODULES_REL), { recursive: true });

        const asSeeded = JSON.parse(trackedBytes);
        writeFileSync(join(root, FLOOR_REL), `${JSON.stringify(asSeeded, null, 2)}\n`, 'utf8');
        git('init', '-q');
        git('config', 'user.name', 'SquabbyZ');
        git('config', 'user.email', '601709253@qq.com');
        git('config', 'core.autocrlf', 'false');
        git('add', '-A');
        git('commit', '-q', '-m', 'seed the floor');

        // …then lower it in the working copy only, which is what a hand edit looks like.
        writeFileSync(
          join(root, FLOOR_REL),
          `${JSON.stringify({ ...asSeeded, linesPct: 5.0 }, null, 2)}\n`,
          'utf8'
        );

        const refused = ratchet(['--report', 'absent.json'], root);
        expect(refused.code, refused.out).toBe(1);
        expect(refused.out).toContain('REFUSING to compare');
        expect(refused.out).toContain('HEAD records');

        // The override is a NAMED act: the anchor lets it through and the run proceeds to the next
        // check — the absent report — so the anchor is provably what refused above.
        const allowed = ratchet(['--lower-floor', '--report', 'absent.json'], root);
        expect(allowed.out).not.toContain('HEAD records');
        expect(allowed.out).toContain('there is no coverage report');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );
});
