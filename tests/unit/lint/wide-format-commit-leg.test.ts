// tests/unit/lint/wide-format-commit-leg.test.ts
//
// The COMMIT path's wide formatting leg — the guard for `.husky/gate/wide-format.mjs`
// and for its wiring into `stagedMode`.
//
// THE DEFECT, MEASURED THREE TIMES BEFORE THIS LEG EXISTED (2026-10-23). A
// `tests/**` file reached a commit UNFORMATTED while every commit-time gate was
// green, and the push gate's format ratchet (`.husky/pre-push` leg 1) refused the
// push — the author had to amend and re-push. The commit gate dropped the file
// before any check ran: `tests/**` is outside the LINT scope (owner decision
// 2026-10-03), so `outOfScopeNotice` removed it from the list the per-file
// ratchet was handed. The commit boundary did not hold: a commit the commit gate
// accepts and the push gate rejects was wrong when it was made.
//
// WHY EVERY RED ARM STAGES A `tests/**` FILE. The red arm must be reachable by
// the wide leg and by NO OTHER. An in-scope `src/**` file also runs the per-file
// eslint and prettier legs, so an arm staged on one would exit 1 with or without
// this leg — and a control that cannot fail reads exactly like one that works.
// `tests/**` is outside the lint scope, so on that input only the leg under test
// can redden the run.
//
// WHY THE OWNER'S 2026-10-03 DECISION STANDS. The lint scope, the eslint leg, the
// per-file baseline rows and the per-file prettier comparison are untouched. The
// owner's recorded objection was that a PER-FILE ratchet "can only cover files
// that HAVE a baseline row"; this leg has no row and needs none — the wide
// check's allowed set is EMPTY and may only shrink, so its rule over its four
// globs is "no unformatted file at all". The arm that pins this is the in-scope
// one below: a staged file inside the lint scope is still the per-file
// ratchet's business, and this leg does not measure it.
//
// Dimensions:
//   - render:      the measurement line, the refusal wording, the empty-set wording
//   - behavior:    refused-on-unformatted / accepted-on-formatted / not-measured
//   - integration: the real gate process, the real prettier, the real fixture repo
//   - a11y:        the exit codes a commit sees, and the sentences it reads
//
// NOTHING IS WRITTEN INTO THE REPOSITORY (backlog §2.31): the fixture lives under
// OS tmp and is removed in `afterAll`.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import { REPO_ROOT, gateModuleText } from '../standards/_file-size-cap-scan.js';
import { createFixture, type Fixture } from './_file-size-hooks-fixture.js';

declareDimensions('tests/unit/lint/wide-format-commit-leg.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const GATE_REL = join('.husky', 'peaks-gate.mjs');
const ARTIFACT_REL = join('.peaks', 'lint', 'gate-baseline.json');
const LEG_REL = join('.husky', 'gate', 'wide-format.mjs');
const RATCHET_REL = join('.husky', 'format-check-ratchet.mjs');

/** Outside the lint scope, INSIDE the wide format scope: this leg's own subject. */
const DIRTY = 'tests/dirty.test.ts';
/** The same, but prettier-clean. */
const CLEAN = 'tests/clean.test.ts';
/** Outside the lint scope AND outside the wide globs: no leg compares it. */
const OUTSIDE_BOTH = 'docs/helper.ts';
/** Inside the lint scope: the per-file ratchet's business, not this leg's. */
const IN_SCOPE = 'src/new-dirty.ts';
/** A file on disk that is unformatted and is NOT in the change set. */
const NOT_STAGED = 'tests/never-staged.test.ts';

/** Two spaces after `const` and unspaced braces: prettier really rewrites this. */
const UNFORMATTED = 'const  dirty={a:1,b:2}\nexport default  dirty\n';
const FORMATTED = 'export const clean = 1;\n';

let fx: Fixture | null = null;

function fixture(): Fixture {
  if (fx === null) {
    fx = createFixture('wide-format-leg');
    const f = fx;
    // `scope.dirs` is what `inScope` reads, so an artifact scoped to `src` is what
    // makes `tests/**` an out-of-scope code file — the shape every arm below needs.
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
    f.write(DIRTY, UNFORMATTED);
    f.write(CLEAN, FORMATTED);
    f.write(OUTSIDE_BOTH, UNFORMATTED);
    f.write(NOT_STAGED, UNFORMATTED);
    f.write(IN_SCOPE, UNFORMATTED);
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

/** The fixture's package.json with its wide format scope re-decided. */
function withFormatScope(script: string, body: () => void): void {
  const f = fixture();
  const path = join('package.json');
  const before = f.read(path);
  const document = JSON.parse(before) as {
    prettier: Record<string, unknown>;
    scripts: Record<string, string>;
  };
  document.scripts['format:check'] = script;
  f.write(path, `${JSON.stringify(document, null, 2)}\n`);
  try {
    body();
  } finally {
    f.write(path, before);
  }
}

afterAll(() => {
  fx?.cleanup();
});

describe('Scenario: behavior — the commit path refuses an unformatted file the lint scope dropped', () => {
  it(
    'when a staged file outside the lint scope is unformatted, should exit 1 naming the file and the remedy',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a staged `tests/**` file that prettier would rewrite
      // when:  the commit gate ratchets the change set
      // then:  the commit is blocked, the file is named, and the remedy is exact
      const run = runStaged([DIRTY]);

      expect(run.code, run.out).toBe(1);
      expect(run.out).toContain('commit blocked — the wide formatting check refused');
      expect(run.out).toContain(`✗ ${DIRTY}`);
      expect(run.out).toContain(`pnpm exec prettier --write "${DIRTY}"`);
    }
  );

  it(
    'when a staged file outside the lint scope is unformatted, should not be excused by the scope notice',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a staged `tests/**` file that prettier would rewrite
      // when:  the commit gate ratchets the change set
      // then:  the two sentences about ONE file do not contradict each other — the
      //        notice says the per-file ratchet did not compare it, and the wide
      //        leg says it DID, and that it is dirty
      const run = runStaged([DIRTY]);
      expect(run.out).toContain(
        `outside the lint scope and were not compared by the per-file ratchet: ${DIRTY}`
      );
      expect(run.out).toContain('wide formatting check');
      expect(run.out).toContain(`compared: ${DIRTY}`);
      // And the reader must not be able to flatten "one file was compared and it was
      // unformatted" into "nothing was checked".
      expect(run.out).not.toContain('NOTHING WAS COMPARED');
    }
  );

  it(
    'when a staged file inside the lint scope is unformatted, should still be refused by the per-file ratchet',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a staged `src/**` file, which is inside the lint scope
      // when:  the commit gate ratchets the change set
      // then:  the per-file ratchet refuses it, and the wide leg did NOT take it
      const run = runStaged([IN_SCOPE]);

      expect(run.code, run.out).toBe(1);
      expect(run.out).toContain(`${IN_SCOPE} is not prettier-formatted`);
      expect(run.out).not.toContain('the wide formatting check refused');
      expect(run.out).toContain('0 of the 1 staged file(s) are in this leg');
    }
  );
});

describe('Scenario: render — a file that was compared and a file that was not are different sentences', () => {
  it(
    'when a staged file outside the lint scope is formatted, should compare it and not refuse',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a staged `tests/**` file that is already prettier-clean
      // when:  the commit gate ratchets the change set
      // then:  it is green, and the output says it was compared — it does not claim a
      //        check ran that did not, and it does not claim a check did not
      const run = runStaged([CLEAN]);

      expect(run.code, run.out).toBe(0);
      expect(run.out).toContain('wide formatting check');
      expect(run.out).toContain(`compared: ${CLEAN} — all prettier-clean.`);
      expect(run.out).not.toContain('the wide formatting check refused');
    }
  );

  it(
    'when a staged file is outside the lint scope and outside the wide globs, should be dropped by the notice and not compared',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a staged `docs/**` file — outside the lint scope AND outside the wide
      //        format scope, so no leg has anything to say about it
      // when:  the commit gate ratchets the change set
      // then:  the notice names it, and the wide leg says plainly that it compared
      //        nothing — the two facts, not one flat "nothing to do here"
      const run = runStaged([OUTSIDE_BOTH]);

      expect(run.code, run.out).toBe(0);
      expect(run.out).toContain(
        `outside the lint scope and were not compared by the per-file ratchet: ${OUTSIDE_BOTH}`
      );
      expect(run.out).toContain('0 of the 1 staged file(s) are in this leg');
      expect(run.out).toContain('no file was format-checked');
      expect(run.out).not.toContain(`compared: ${OUTSIDE_BOTH}`);
    }
  );

  it(
    'when the change set holds no code file at all, should keep the empty-set sentence and exit 0',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a staged docs file — not a code file, so no leg has a subject
      // when:  the commit gate ratchets the change set
      // then:  the empty-set sentence, and the wide leg's own zero line beside it
      const run = runStaged(['notes/plain.md']);

      expect(run.code, run.out).toBe(0);
      expect(run.out).toContain('EMPTY CHANGE SET (staged)');
      expect(run.out).toContain('no file was format-checked');
    }
  );
});

describe('Scenario: integration — the scope is SOURCED from package.json, not restated', () => {
  it(
    'when the format:check scope is re-decided, should change what the leg measures',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: the same unformatted `tests/**` file, under a wide scope that no
      //        longer covers `tests/**`
      // when:  the commit gate ratchets the change set
      // then:  the file is no longer the leg's subject, so the leg does not
      //        refuse it — the scope moved, and the measurement moved with it
      withFormatScope('prettier --check "src/**/*.{ts,mts,mjs,js}"', () => {
        const run = runStaged([DIRTY]);

        expect(run.code, run.out).toBe(0);
        expect(run.out).toContain('0 of the 1 staged file(s) are in this leg');
        expect(run.out).not.toContain('the wide formatting check refused');
      });

      // and the control: with the repository's own scope, the same file IS refused
      const wide = runStaged([DIRTY]);
      expect(wide.code, wide.out).toBe(1);
      expect(wide.out).toContain('the wide formatting check refused');
    }
  );

  it('when the commit mode is inspected, should be wired to the wide-format leg and read the scope through the one reader', () => {
    // given: the gate's module set and the sibling leg beside it
    // when:  the wiring and the scope reader are inspected
    // then:  the commit mode calls the leg, and the scope comes from the one
    //        reader the CI ratchet uses — a leg nothing calls enforces nothing,
    //        and a second copied glob list would be a scope nothing observes
    expect(gateModuleText()).toMatch(/wideFormatLeg\(all\)/);
    const leg = readFileSync(join(REPO_ROOT, LEG_REL), 'utf8');
    expect(leg).toContain("from '../../.husky/format-check-ratchet.mjs'");
    expect(leg).toContain('readCheckGlobs');
    expect(readFileSync(join(REPO_ROOT, RATCHET_REL), 'utf8')).toContain(
      'export { readCheckGlobs }'
    );
  });
});

describe('Scenario: a11y — the leg is staged-only, and a clean file is a clean file', () => {
  it(
    'when an unformatted file is not in the change set, should not refuse it',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: an unformatted file on disk that the change set does not name
      // when:  the commit gate ratchets a change set that holds only the clean one
      // then:  green, and the file nobody staged is not even mentioned
      const run = runStaged([CLEAN]);

      expect(run.code, run.out).toBe(0);
      expect(run.out).not.toContain(NOT_STAGED);
    }
  );

  it(
    'when the scope cannot be read, should refuse rather than measure nothing',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a `format:check` scope that cannot be derived
      // when:  the commit gate ratchets the change set
      // then:  the leg refuses rather than measuring nothing — a scope that cannot
      //        be derived is not an empty scope: "nothing to check" and "checked
      //        and clean" look identical in an exit code
      withFormatScope('echo not-a-prettier-invocation', () => {
        const run = runStaged([DIRTY]);
        expect(run.code, run.out).toBe(1);
        expect(run.out).toContain('REFUSING to measure the wide formatting check');
        expect(run.out).not.toContain('no file was format-checked');
      });
    }
  );
});
