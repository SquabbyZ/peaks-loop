// tests/unit/scripts/check-build-integrity-nothing-to-check.test.ts
//
// THE VERDICT OF A GATE THAT HAD NOTHING TO CHECK, EXECUTED.
//
// THE DEFECT (backlog §2.18). `scripts/check-build-integrity.mjs` skips a
// package with no `.ts` source, so a tree of zero source-bearing packages
// walked zero package entries and fell through to the SAME success line a
// tree of twenty verified packages prints — `build-integrity: OK`. "I
// checked twenty packages and they agree" and "I checked nothing" were the
// same six characters, and the script sits in the middle of two `&&` chains
// (`build` and `pretest`), so a gate that can say OK without having checked
// anything is a gate that can be skipped by omission. The sibling file
// (`check-build-integrity.test.ts`) covers the WALK; this file covers the
// VERDICT of the empty set.
//
// THE RULING this file pins: a gate with nothing to check must SAY SO, and
// must NOT fail. The exit code stays 0 — the empty set is legal (a tree can
// genuinely hold no source-bearing package, and a red would break the
// `build` and `pretest` chains on a legitimate tree) — and the message must
// be distinguishable from the all-clear.
//
// THE CONTAINMENT QUESTION, which is the whole point of this file. A
// message like `build-integrity: OK (nothing to check)` still CONTAINS
// `build-integrity: OK`: a reader (or a grep) that flattens the output to
// the bare all-clear would read a check that never happened as a check that
// passed. So the arms below assert the ABSENCE of the bare all-clear
// string, not merely the presence of new words. The shipped message leads
// with `NOTHING WAS COMPARED`, which no flattening turns into the
// all-clear.
//
// WHY ITS OWN FILE, and why the arms run a COPY of the gate: the gate has
// no exports, runs its loop at import time and `process.exit(1)`s, so it
// cannot be imported; and it carries no root override, because it derives
// its root from its own location (`resolve(scriptDir, '..')`). Copying its
// bytes to `<fixture>/scripts/` makes that fixture the root it walks — the
// copy is taken at RUN TIME from the shipped file, so no arm can drift from
// the gate text it is asserting.
//
// What reddens these arms: restore the single unconditional
// `build-integrity: OK` print and delete the `sourceBearing === 0` branch.
// The two empty-set arms then read the all-clear, and the absence
// assertions go red.
//
// Dimensions: `render` is omitted — the gate's stdout is its verdict line,
// and this file asserts the verdict, not the rendering — and `behavior` is
// omitted — the gate returns nothing and holds no state; its verdict IS the
// exit status and the message, asserted under `a11y`.

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { fixture, REPO_ROOT, writeBuilt } from '../_setup/packages-build-fixture.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

declareDimensions(
  'tests/unit/scripts/check-build-integrity-nothing-to-check.test.ts',
  ['integration', 'a11y'],
  [
    {
      dim: 'render',
      reason: 'the gate prints one verdict line; this file asserts the verdict, not the rendering'
    },
    {
      dim: 'behavior',
      reason:
        'the gate returns nothing and holds no state — its verdict IS the exit status and the message, asserted under a11y'
    }
  ]
);

/** The all-clear the gate prints on a tree it actually verified. */
const ALL_CLEAR = 'build-integrity: OK';

/**
 * The gate's own bytes, copied into `root` at run time. The copy lands at
 * `<root>/scripts/check-build-integrity.mjs`, so the root it derives from its
 * own location is `root` — the fixture, not this repository.
 */
function copyGate(root: string): string {
  const target = join(root, 'scripts', 'check-build-integrity.mjs');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  copyFileSync(join(REPO_ROOT, 'scripts', 'check-build-integrity.mjs'), target);
  return target;
}

/**
 * Run a gate copy. `cwd` is deliberately NOT set: the gate derives its root
 * from its own location, so an arm that only passed from one working
 * directory would be pinning the wrong thing.
 */
function runGate(root: string): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [copyGate(root)], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: SUBPROCESS_TEST_TIMEOUT_MS
  });
}

/**
 * A tree whose `packages/` holds no package at all — the shape that reads the
 * same as "this is not the repository", and the one the writer's refusal
 * (`write-package-dist-stamps.mjs`) already treats as a refusal.
 */
function emptyPackagesTree(): string {
  return fixture({});
}

/**
 * A tree whose `packages/` holds three packages and NOT ONE of them carries a
 * TypeScript source: one with no `src/` at all, one whose `src/` holds a
 * non-TypeScript entry, and one whose `src/` holds only a declaration file.
 *
 * The last two are the "sourceless but not empty" shape — a `src/` left
 * behind after its sources were deleted — which is a different fact from "the
 * tree is empty", so the message has to name both numbers to tell them
 * apart.
 */
function sourcelessPackagesTree(): string {
  const root = fixture({});
  mkdirSync(join(root, 'packages', 'no-src'), { recursive: true });
  mkdirSync(join(root, 'packages', 'markdown-src', 'src'), { recursive: true });
  writeFileSync(join(root, 'packages', 'markdown-src', 'src', 'readme.md'), 'notes\n', 'utf8');
  mkdirSync(join(root, 'packages', 'declaration-src', 'src'), { recursive: true });
  writeFileSync(
    join(root, 'packages', 'declaration-src', 'src', 'index.d.ts'),
    'export {};\n',
    'utf8'
  );
  return root;
}

/**
 * A tree whose one package carries a source AND the build that agrees with
 * it — the ordinary tree, whose verdict is the all-clear.
 */
function agreeingTree(): string {
  const root = fixture({ a: 'export const a = 1;\n' });
  writeBuilt(root, 'a');
  // Rule 3 refuses a `dist/*.js` with no `.d.ts` beside it, so the fixture
  // carries the sibling the real tree carries.
  writeFileSync(
    join(root, 'packages', 'a', 'dist', 'index.d.ts'),
    'export declare const a: 1;\n',
    'utf8'
  );
  return root;
}

/**
 * A tree whose one package carries a source and NO build — the refusal.
 */
function unbuiltTree(): string {
  return fixture({ a: 'export const a = 1;\n' });
}

describe('Scenario: integration — a tree with nothing to compare is still a legal tree', () => {
  it(
    'when no package carries a TypeScript source, should exit 0 and write nothing to stderr',
    () => {
      // given: a root whose `packages/` is present and holds no package at all
      // when:  the gate is run over it
      // then:  it exits 0 and says nothing on stderr — the empty set is legal,
      //        and a red here would break the `build` and `pretest` chains
      const result = runGate(emptyPackagesTree());

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'when every package is sourceless, should exit 0 and write nothing to stderr',
    () => {
      // given: a root whose `packages/` holds three packages and no source
      // when:  the gate is run over it
      // then:  it exits 0 and says nothing on stderr — a package with no
      //        source is skipped, not an error
      const result = runGate(sourcelessPackagesTree());

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );
});

describe('Scenario: a11y — the nothing-to-check message cannot be flattened into the all-clear', () => {
  it(
    'when no package carries a TypeScript source, should not print the all-clear and should name the count',
    () => {
      // given: a root whose `packages/` holds no package at all
      // when:  the gate is run over it
      // then:  its line does NOT contain the bare all-clear — a reader that
      //        flattens the output must not be able to read a check that
      //        never happened as a check that passed — and it names the count
      const result = runGate(emptyPackagesTree());

      expect(result.stdout).not.toContain(ALL_CLEAR);
      expect(result.stdout).toContain('NOTHING WAS COMPARED');
      expect(result.stdout).toContain('0 source-bearing package(s) of 0 package(s) considered');
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'when every package is sourceless, should name how many were considered and how many were skipped',
    () => {
      // given: a root whose `packages/` holds three sourceless packages
      // when:  the gate is run over it
      // then:  its line does NOT contain the bare all-clear, and it names BOTH
      //        numbers — three considered and three skipped is a different fact
      //        from an empty tree, and only the numbers tell them apart
      const result = runGate(sourcelessPackagesTree());

      expect(result.stdout).not.toContain(ALL_CLEAR);
      expect(result.stdout).toContain('0 source-bearing package(s) of 3 package(s) considered');
      expect(result.stdout).toContain('3 skipped for having no src/*.ts');
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'when a package agrees with its build, should print the all-clear and nothing else',
    () => {
      // given: the ordinary tree, with one package whose source and build agree
      // when:  the gate is run over it
      // then:  it prints the all-clear unchanged — the load-bearing arm, so the
      //        branch above cannot be satisfied by breaking the gate
      const result = runGate(agreeingTree());

      expect(result.status).toBe(0);
      expect(result.stdout).toBe('build-integrity: OK\n');
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'when a package is missing its build, should stay red and print nothing on stdout',
    () => {
      // given: a tree whose one package carries a source and no build
      // when:  the gate is run over it
      // then:  it exits 1, names the missing emit, and prints NOTHING on
      //        stdout — the nothing-to-check branch must not hijack the
      //        refusal path
      const result = runGate(unbuiltTree());

      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('missing dist/index.js');
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );
});
