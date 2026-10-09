// tests/unit/lint/gate-empty-result-exit-codes.test.ts
//
// rid-038 W2/D1 — the gate's THREE empty results, told apart by EXIT CODE.
//
// The defect (measured 2026-10-09): `node .husky/peaks-gate.mjs staged`, typed with
// no paths at all, printed "EMPTY CHANGE SET (staged) — 0 in-scope files, NOTHING WAS
// CHECKED" and exited 0. The sentence was honest and the exit code was not: a caller
// that reads only the exit code reads a misuse as a PASS, and one did.
//
// The fix is deliberately NOT "empty means failure". `staged` takes its file list
// from argv because lint-staged passes the staged paths to it, and lint-staged does
// NOT run a command whose glob matched nothing — so "no file in argv" cannot come
// from the commit path. That makes it decidable, and only that is refused. The two
// OTHER empty results are real and must stay green:
//
//   A  staged, no file argument at all        → exit 2, and it says USAGE
//   B  staged, files given, ALL out of scope  → exit 0, a scope exemption
//   C  changed, nothing to compare            → exit 0, a real no-change
//
// B is the CONTROL ARM for A, not a restatement of somebody else's arm: it is what
// proves the refusal is placed where only "no file was handed to me" can reach it.
// (`gate-scope-exemption.test.ts` states B's fact for the SCOPE reason; this file
// states it for the EXIT-CODE reason. Both read the same gate.)
//
// NOTHING IS WRITTEN INTO THE REPOSITORY (backlog §2.31). All three arms run the real
// gate inside one fixture repository under OS tmp, removed in `afterAll`.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import { createFixture, type Fixture } from './_file-size-hooks-fixture.js';

declareDimensions(
  'tests/unit/lint/gate-empty-result-exit-codes.test.ts',
  ['integration', 'a11y'],
  [
    {
      dim: 'render',
      reason:
        'the subject is a process exit code and its sentence; there is no structured output shape to assert'
    },
    {
      dim: 'behavior',
      reason:
        'every arm runs the gate as a child process, so the boundary (fs, git, spawn) is the dimension under test, not an in-process return value'
    }
  ]
);

const GATE_REL = join('.husky', 'peaks-gate.mjs');
const ARTIFACT_REL = join('.peaks', 'lint', 'gate-baseline.json');

let fx: Fixture | null = null;

/** One fixture repo: an artifact whose scope is `src` only, plus an out-of-scope code file. */
function fixture(): Fixture {
  if (fx === null) {
    fx = createFixture('gate-empty-result');
    const f = fx;
    // `scope.dirs` is what `inScope` reads (`context.mjs` -> `scopeDirs()`), so an
    // artifact scoped to `src` is what makes `tests/dirty.ts` an out-of-scope code
    // file — the shape arm B needs, hand-built here rather than generated.
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
    // Prettier-clean and eslint-quiet by construction: these arms assert exit codes,
    // never a finding, so no arm may depend on lint output.
    const write = (rel: string, text: string): void => {
      const abs = join(f.root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, text, 'utf8');
    };
    write('tests/dirty.ts', 'export const dirty = 1;\n');
    // COMMITTED, not left untracked: arm C's docs-only commit runs `git add -A`, and
    // an untracked code file would be swept into that commit and join the changed
    // set — turning the no-change arm into the scope-exemption arm by accident.
    f.commitAll('fixture: the out-of-scope code file, tracked in the base');
  }
  return fx;
}

type GateRun = { code: number; out: string };

function runGate(mode: string, args: readonly string[], env: Record<string, string> = {}): GateRun {
  const f = fixture();
  const spawned = spawnSync(process.execPath, [GATE_REL, mode, ...args], {
    cwd: f.root,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, ...env }
  });
  if (spawned.error !== undefined) throw spawned.error;
  return { code: spawned.status ?? 1, out: `${spawned.stdout ?? ''}${spawned.stderr ?? ''}` };
}

afterAll(() => {
  fx?.cleanup();
});

describe('Scenario: integration — an empty result is classified by its exit code', () => {
  it(
    'A: `staged` with no file argument is a MISUSE — exit 2, said out loud as USAGE',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: the gate invoked the way the 2026-10-09 incident invoked it
      // when:  it is asked to ratchet a change set it was never handed
      const run = runGate('staged', []);

      // then:  the exit code separates it from a pass, and the sentence says why
      expect(run.code, run.out).toBe(2);
      expect(run.out).toContain('USAGE (staged)');
      expect(run.out).toContain('NO file argument');
      // The old sentence may not be printed beside a refusal: two different facts
      // sharing one output is the shape this slice exists to end.
      expect(run.out).not.toContain('EMPTY CHANGE SET');
    }
  );

  it(
    'A (spelling): `staged ""` — a blank argument is not a file, so it is the same misuse',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: `staged "$FILES"` with an empty `$FILES` — the other shell spelling
      // when:  it reaches the gate
      const run = runGate('staged', ['']);

      // then:  it is refused exactly as `staged` with no argument is
      expect(run.code, run.out).toBe(2);
      expect(run.out).toContain('USAGE (staged)');
    }
  );
});

describe('Scenario: a11y — the two LEGITIMATE empty results keep exit 0', () => {
  it(
    'B (control arm): a change set whose code files are ALL out of scope is an exemption, not a misuse',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a staged change set that DOES name a code file, outside the lint scope
      // when:  the gate ratchets it
      const run = runGate('staged', ['tests/dirty.ts']);

      // then:  this is the scope exemption, it exits 0, and it does NOT print the
      //        refusal — i.e. arm A's check did not swallow a legitimate path
      expect(run.code, run.out).toBe(0);
      expect(run.out).toContain('outside the lint scope');
      expect(run.out).toContain('NOTHING WAS COMPARED');
      expect(run.out).not.toContain('USAGE (staged)');
    }
  );

  it(
    'C: `changed` mode with nothing to compare is a no-change — exit 0, not a refusal',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const f = fixture();
      // given: the fixture's last commit as the base, then a pushed change whose only
      //        member is a non-code file. No extra base commit: `commitAll` stages and
      //        commits, and a second commit with nothing to stage would fail.
      const base = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: f.root,
        encoding: 'utf8',
        windowsHide: true
      }).trim();
      const abs = join(f.root, 'README.md');
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, '# fixture\n', 'utf8');
      f.commitAll('fixture: a docs-only change');

      // when:  the push gate measures the changed set
      const run = runGate('changed', [], { PEAKS_GATE_CHANGED_BASE: base });

      // then:  it is a real no-change: exit 0, the empty-set sentence, no refusal
      expect(run.code, run.out).toBe(0);
      expect(run.out).toContain('EMPTY CHANGE SET (changed');
      expect(run.out).not.toContain('USAGE (staged)');
    }
  );
});
