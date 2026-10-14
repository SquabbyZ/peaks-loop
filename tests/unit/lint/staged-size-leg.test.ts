// tests/unit/lint/staged-size-leg.test.ts
//
// The COMMIT path's file-size leg (backlog §9.46) — the guard for
// `.husky/gate/staged-size.mjs` and for its wiring into `stagedMode`.
//
// THE DEFECT, MEASURED BEFORE THIS LEG EXISTED (2026-10-14, on the real repository): a
// `tests/**` file of 501 raw lines under a 500 cap, grown to 504 and handed to
// `node .husky/peaks-gate.mjs staged`, printed "NOTHING WAS COMPARED" and exited 0 —
// because `tests/**` is outside the LINT scope, so no leg saw it at all.
// `peaks scan file-size --project .`, the transition path's surface, exited 1 on the same
// file with `lines 504, cap 500, previousLines 501`.
//
// WHY EVERY ARM STAGES A `tests/**` FILE. The red arm must be reachable by the size leg
// and by NO OTHER. An in-scope `src/**` file also runs the eslint and prettier legs, whose
// fixture stubs answer with an empty report on purpose, so an arm staged on one would exit
// 1 with or without this leg — and a control that cannot fail reads exactly like one that
// works. `tests/**` is outside the lint scope, so on this input only the leg under test
// can redden the run.
//
// THE REUSE ARM IS A CROSS-MEASUREMENT, NOT A TEXT PIN. This slice could have
// re-implemented the per-file delta rule inside `.husky/`, which is the drift shape this
// repository keeps recording. It does not: the leg spawns `scripts/lint/file-size-delta.ts`,
// which calls the SAME `scanFileSize` the transition path calls. The arms below run that
// shared function in-process against the SAME fixture repository and the same file list the
// leg was handed, in BOTH directions, so the two cannot quietly become two opinions.
//
// Dimensions:
//   - render:      the measurement line, the refusal wording, the "not measured" wording
//   - behavior:    refused-on-growth / accepted-on-edit / not-measured
//   - integration: the real gate process, the real tool, the real fixture repository
//   - a11y:        the exit codes a commit sees (0 held, 1 refusal, 1 fail-closed)
//
// NOTHING IS WRITTEN INTO THE REPOSITORY (backlog §2.31): the fixture lives under OS tmp
// and is removed in `afterAll`.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import {
  FILE_SIZE_CAP_DEFAULT,
  FILE_SIZE_CAP_TESTS
} from '../../../src/services/scan/file-size-policy.js';
import { scanFileSize } from '../../../src/services/scan/file-size-scan.js';
import { REPO_ROOT, gateModuleText } from '../standards/_file-size-cap-scan.js';
import { createFixture, fileOf, type Fixture } from './_file-size-hooks-fixture.js';

declareDimensions('tests/unit/lint/staged-size-leg.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const GATE_REL = join('.husky', 'peaks-gate.mjs');
const ARTIFACT_REL = join('.peaks', 'lint', 'gate-baseline.json');
const DELTA_TOOL_REL = join('scripts', 'lint', 'file-size-delta.ts');
const LEG_REL = join('.husky', 'gate', 'staged-size.mjs');
/** The file every red/green arm stages: out of the lint scope, inside the policy's. */
const SUBJECT = 'tests/huge.test.ts';
/** A tracked `tests/` file no arm ever edits — the "not in the change set" input. */
const STABLE = 'tests/stable.test.ts';

let fx: Fixture | null = null;

function fixture(): Fixture {
  if (fx === null) {
    fx = createFixture('staged-size-leg');
    const f = fx;
    // The artifact is what `context.mjs` refuses to run without; these arms are about the
    // size leg, so it carries no rows and no ceilings.
    f.write(
      ARTIFACT_REL,
      `${JSON.stringify(
        {
          version: 3,
          scope: { dirs: ['src'], extensions: 'ts, tsx, mts, cts, mjs, cjs, js' },
          phantomRules: [],
          ceilings: {},
          files: {}
        },
        null,
        2
      )}\n`
    );
    // A `tests/` file ALREADY over the 500 cap and committed, so every later arm changes
    // it against a previous size git can read.
    f.write(SUBJECT, fileOf(FILE_SIZE_CAP_TESTS + 3));
    f.write(STABLE, '// a fixture file nobody edits\n');
    f.commitAll('fixture: an over-cap test file, tracked in the base');
  }
  return fx;
}

type GateRun = { readonly code: number; readonly out: string };

function runStaged(args: readonly string[]): GateRun {
  const f = fixture();
  const spawned = spawnSync(process.execPath, [GATE_REL, 'staged', ...args], {
    cwd: f.root,
    encoding: 'utf8',
    windowsHide: true
  });
  if (spawned.error !== undefined) throw spawned.error;
  return { code: spawned.status ?? 1, out: `${spawned.stdout ?? ''}${spawned.stderr ?? ''}` };
}

/** Rewrite the subject at `lines` lines, changing its bytes without changing its size. */
function rewriteSubject(lines: number): void {
  const abs = join(fixture().root, SUBJECT);
  mkdirSync(dirname(abs), { recursive: true });
  // A different first byte, so `git diff` reports M on an otherwise identically sized
  // file — the accept direction's input, which a byte-identical rewrite would not give.
  writeFileSync(abs, `y${fileOf(lines).slice(1)}`, 'utf8');
}

/** What the ONE rule says about the subject right now, in this same fixture repo. */
function sharedVerdict(): ReturnType<typeof scanFileSize> {
  return scanFileSize({ projectRoot: fixture().root, files: [SUBJECT] });
}

afterAll(() => {
  fx?.cleanup();
});

describe('Scenario: behavior — the commit path refuses growth, on the input it was filed for', () => {
  it(
    'when an over-cap staged file grows, should exit 1 naming file, size, cap and growth',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      rewriteSubject(FILE_SIZE_CAP_TESTS + 6);
      const run = runStaged([SUBJECT]);

      expect(run.code, run.out).toBe(1);
      expect(run.out).toContain('commit blocked — the staged file-size ratchet refused');
      // The refusal carries the numbers that decided it: a verdict without its evidence
      // is unreviewable from the log alone.
      expect(run.out).toContain(
        `${SUBJECT}: ${FILE_SIZE_CAP_TESTS + 6} lines > cap ${FILE_SIZE_CAP_TESTS} ` +
          `(was ${FILE_SIZE_CAP_TESTS + 3} at HEAD, +3)`
      );
      expect(run.out).toContain('Split the file into modules');
      // The measurement is printed beside the refusal, so "refused" never arrives without
      // "here is what I saw".
      expect(run.out).toContain('1 of 1 staged path(s) measured');
    }
  );

  it(
    'when the over-cap file is NEW in this commit, should refuse it as a creation by name',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const created = 'tests/created-big.test.ts';
      fixture().write(created, fileOf(FILE_SIZE_CAP_TESTS + 4));
      const run = runStaged([created]);

      expect(run.code, run.out).toBe(1);
      expect(run.out).toContain(
        `${created}: ${FILE_SIZE_CAP_TESTS + 4} lines > cap ${FILE_SIZE_CAP_TESTS} ` +
          `(created at ${FILE_SIZE_CAP_TESTS + 4} lines)`
      );
      rmSync(join(fixture().root, created), { force: true });
    }
  );
});

describe('Scenario: behavior — a file you touch may be touched, and may not get worse', () => {
  it(
    'when an over-cap staged file is edited without growing, should stay green',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // THE ARM THAT KEEPS THIS GATE FROM TEACHING `--no-verify`. 33 tracked files under
      // `tests/` are over the 500 cap today; refusing any over-cap file would refuse the
      // majority of ordinary edits to them, and that standing debt is already ratcheted by
      // the whole-tree rows this leg deliberately does not touch.
      rewriteSubject(FILE_SIZE_CAP_TESTS + 3);
      const run = runStaged([SUBJECT]);

      expect(run.code, run.out).toBe(0);
      expect(run.out).toContain('1 already over cap and not grown');
      expect(run.out).toContain('0 grown past their cap');
      expect(run.out).not.toContain('commit blocked');
    }
  );

  it(
    'when several staged paths are measured, should count them all and stay green',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      rewriteSubject(FILE_SIZE_CAP_TESTS + 3);
      const other = 'tests/small.test.ts';
      fixture().write(other, '// small\n');
      const run = runStaged([SUBJECT, other]);

      expect(run.code, run.out).toBe(0);
      expect(run.out).toContain('2 of 2 staged path(s) measured');
      rmSync(join(fixture().root, other), { force: true });
    }
  );
});

describe('Scenario: render — "not measured" and "nothing grew" are different sentences', () => {
  it(
    'when a staged path git reports no change for is handed in, should say it measured nothing',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // argv is the population, and a caller can name a path that is not in the change
      // set. That is not a clean file — it is a file that was never compared, and the leg
      // says so instead of printing a zero that reads like a pass.
      const run = runStaged([STABLE]);
      expect(run.code, run.out).toBe(0);
      expect(run.out).toContain('NOTHING WAS MEASURED');
      expect(run.out).toContain('not reported as changed by git');
      expect(run.out).toContain('not the same sentence as "nothing grew"');
    }
  );

  it(
    'the leg holds no cap of its own — the number it prints moves when the policy moves',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // The defect this slice exists to prevent, one level in, is a SECOND copy of the
      // rule. So the arm is behavioural, not a text scan: the fixture's copy of the
      // POLICY module is re-decided, and the leg's own sentence must move with it. A leg
      // holding a literal 500 would keep printing 500 here — which is what a text scan
      // cannot tell you, and what this can.
      const f = fixture();
      const policy = join('src', 'services', 'scan', 'file-size-policy.ts');
      const before = f.policyText();
      const reDecided = FILE_SIZE_CAP_TESTS + 1;
      try {
        f.patchPolicy((text) =>
          text.replace(
            `export const FILE_SIZE_CAP_TESTS = ${String(FILE_SIZE_CAP_TESTS)};`,
            `export const FILE_SIZE_CAP_TESTS = ${String(reDecided)};`
          )
        );
        // Same size as HEAD, still over the (now re-decided) cap: accepted, and the line
        // prints the caps the envelope carried.
        rewriteSubject(FILE_SIZE_CAP_TESTS + 3);
        const run = runStaged([SUBJECT]);
        expect(run.code, run.out).toBe(0);
        expect(run.out).toContain(`/ ${String(reDecided)} (tests/)`);
        // The control: the number the policy said BEFORE the patch is not in the caps
        // sentence, so the arm cannot pass by printing both.
        expect(run.out).not.toContain(`/ ${String(FILE_SIZE_CAP_TESTS)} (tests/)`);
      } finally {
        f.write(policy, before);
      }
    }
  );
});

describe('Scenario: integration — one rule, cross-measured against the shared function', () => {
  it(
    'when the shared scan reports a violation, the gate refuses and names the same numbers',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      rewriteSubject(FILE_SIZE_CAP_TESTS + 6);
      const shared = sharedVerdict();
      const run = runStaged([SUBJECT]);

      expect(shared.violations).toHaveLength(1);
      const v = shared.violations[0];
      if (v === undefined) throw new Error('expected exactly one violation');
      expect(run.code).toBe(1);
      expect(run.out).toContain(`${v.file}: ${v.lines} lines > cap ${v.cap}`);
      expect(run.out).toContain(`was ${String(v.previousLines)} at HEAD`);
    }
  );

  it(
    'when the shared scan accepts the same file, the gate stays green',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // The other direction of the same cross-measurement, and what makes the agreement
      // non-vacuous: an arm that only ever compared two refusals would pass for a leg that
      // refused everything.
      rewriteSubject(FILE_SIZE_CAP_TESTS + 3);
      const shared = sharedVerdict();
      const run = runStaged([SUBJECT]);

      expect(shared.violations).toHaveLength(0);
      expect(shared.acceptedOverCapFiles).toEqual([SUBJECT]);
      expect(run.code, run.out).toBe(0);
    }
  );

  it('is wired into the commit mode, and reaches the shared tool rather than re-deciding', () => {
    // A leg nothing calls enforces nothing. POOLED over the gate's module set: the wiring
    // is in `stagedMode` and the leg in a sibling, so a pin that named one file would go
    // red for the right reason the day either moves.
    expect(gateModuleText()).toMatch(/stagedSizeLeg\(all, ROOT\)/);
    // The tool it spawns is the one that calls the shared scan. A TEXT pin only — the
    // behavioural claim is the cross-measurement in the two arms above.
    const tool = readFileSync(join(REPO_ROOT, DELTA_TOOL_REL), 'utf8');
    expect(tool).toContain(
      `import { scanFileSize } from '../../src/services/scan/file-size-scan.js';`
    );
    expect(readFileSync(join(REPO_ROOT, LEG_REL), 'utf8')).toContain('file-size-delta.ts');
  });
});

describe('Scenario: integration — the leg is inert over this repository', () => {
  it(
    'when the current change set is measured, should refuse nothing this session wrote',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // MEASURED, not argued. The files this slice edits are the only ones that can move
      // under the leg, and the whole point of the accept direction is that touching a file
      // is not the same as growing it. An empty change set is a legitimate answer here (a
      // clean tree passes the gate too), so the arm asserts the number of refusals rather
      // than the number of files.
      const changed = changedPathsInRepo();
      const spawned = spawnSync(
        process.execPath,
        ['node_modules/tsx/dist/cli.mjs', DELTA_TOOL_REL, '--json', ...changed],
        { cwd: REPO_ROOT, encoding: 'utf8', windowsHide: true }
      );
      if (spawned.error !== undefined) throw spawned.error;
      if (changed.length === 0) {
        // Exit 2 with no paths is the tool's misuse refusal; with paths it is 0 or 1.
        expect(spawned.status).toBe(2);
        return;
      }
      const envelope = JSON.parse(spawned.stdout) as {
        violations: readonly unknown[];
        checkedFiles: number;
        scope: { countedFiles: number };
      };
      expect(envelope.scope.countedFiles).toBe(changed.length);
      expect(envelope.checkedFiles).toBeGreaterThan(0);
      expect(envelope.violations, spawned.stdout).toEqual([]);
    }
  );
});

describe('Scenario: a11y — a tool that cannot run is a failure, never a zero', () => {
  it('names the caps the policy decided and the population it spoke for', () => {
    rewriteSubject(FILE_SIZE_CAP_TESTS + 3);
    const run = runStaged([SUBJECT]);
    expect(run.code, run.out).toBe(0);
    expect(run.out).toContain(String(FILE_SIZE_CAP_DEFAULT));
    expect(run.out).toContain(String(FILE_SIZE_CAP_TESTS));
    expect(run.out).toContain('staged file-size ratchet');
  });

  it(
    'when the measurement tool is missing, should refuse with exit 1 and claim no measurement',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // THE FAIL-CLOSED ARM, and it is LAST: it removes a file the fixture staged at
      // creation, so it may not run before the arms that need it. The input is the one the
      // check exists to reject — a tool that produced no envelope — and the failure it
      // must produce is a REFUSAL, not a green.
      const tool = join(fixture().root, DELTA_TOOL_REL);
      const original = readFileSync(join(REPO_ROOT, DELTA_TOOL_REL), 'utf8');
      rmSync(tool, { force: true });
      try {
        rewriteSubject(FILE_SIZE_CAP_TESTS + 6);
        const run = runStaged([SUBJECT]);
        expect(run.code, run.out).toBe(1);
        expect(run.out).toContain('REFUSING to measure the staged file-size ratchet');
        expect(run.out).toContain('gate FAILURE, not a zero');
        expect(run.out).not.toContain('NOTHING WAS MEASURED');
        expect(run.out).not.toContain('0 grown past their cap');
      } finally {
        writeFileSync(tool, original, 'utf8');
      }
    }
  );
});

/** The change set of THIS repository, roughly as `staged` is handed it by lint-staged. */
function changedPathsInRepo(): string[] {
  const spawned = spawnSync('git', ['-C', REPO_ROOT, 'diff', '--name-status', 'HEAD'], {
    encoding: 'utf8',
    windowsHide: true
  });
  if (spawned.error !== undefined) throw spawned.error;
  const untracked = spawnSync(
    'git',
    ['-C', REPO_ROOT, 'ls-files', '--others', '--exclude-standard'],
    { encoding: 'utf8', windowsHide: true }
  );
  return `${spawned.stdout}${untracked.stdout}`
    .split(/\r?\n/)
    .map((line) => line.split('\t').pop() ?? '')
    .map((file) => file.trim())
    .filter((file) => file !== '');
}
