// tests/unit/scripts/check-build-integrity.test.ts
//
// The gate, EXECUTED. `scripts/check-build-integrity.mjs` is the rule this
// slice's other two files were widened to match, and until this file nothing
// ran it: QA cycle 1 measured the gate reverted to its top-level walk with
// `tests/unit/scripts/` still 60/60 green.
//
// Why the arms run a COPY of the gate rather than the gate itself:
//   the gate has no exports, runs its loop at import time and `process.exit(1)`s,
//   so it cannot be imported; and it carries no root override, because it
//   derives its root from its own location (`resolve(scriptDir, '..')`).
//   Copying its bytes to `<fixture>/scripts/` makes that fixture the root it
//   walks — no production change, no override to keep in sync — and the copy is
//   taken at RUN TIME from the shipped file, so no arm can drift from the gate
//   text it is asserting.
//
// Why the tree carries `.d.ts` siblings: rule 3 refuses a `dist/*.js` with no
// `.d.ts` beside it. `nestedFixture()` — the guard's fixture — has no need for
// them, because the guard never reads them, so they are written here beside the
// gate's arms rather than into the shared fixture.
//
// What reddens these arms: `readdirSync(dir)` in place of the gate's recursive
// `listFiles`. The refusal arm then reads exit 0 (a missing nested emit is
// invisible one level up) and the control arm reads exit 1 (one walk at one
// level reports every nested source as an artifact that is missing). Both
// directions are measured in the repair's handoff.
//
// Dimensions: `render` is omitted — the gate's only stdout is its `OK` line, and
// this file asserts the verdict, not the rendering — and `behavior` is omitted —
// the gate returns nothing and holds no state; its verdict IS the exit status
// and the message, asserted under `a11y`.

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { NESTED_EMIT, nestedFixture, REPO_ROOT } from '../_setup/packages-build-fixture.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

declareDimensions(
  'tests/unit/scripts/check-build-integrity.test.ts',
  ['integration', 'a11y'],
  [
    {
      dim: 'render',
      reason:
        'the gate renders only its `OK` line; this file asserts the verdict, not the rendering'
    },
    {
      dim: 'behavior',
      reason:
        'the gate returns nothing and holds no state — its verdict IS the exit status and the message, asserted under a11y'
    }
  ]
);

/** A declaration sibling. The gate reads only its EXISTENCE (its rule 3). */
const DECLARATION = 'export declare const a: 1;\n';

/**
 * `nestedFixture()` plus the `.d.ts` sibling rule 3 requires of every
 * `dist/*.js`. Without them the gate refuses BOTH arms and the control would
 * prove nothing about the walk.
 */
function gateTree(): string {
  const root = nestedFixture();
  for (const emit of ['dist/index.js', NESTED_EMIT]) {
    writeFileSync(join(root, 'packages', 'a', emit.replace(/\.js$/, '.d.ts')), DECLARATION, 'utf8');
  }
  return root;
}

/**
 * The gate's own bytes, copied into `root` at run time. The copy lands at
 * `<root>/scripts/check-build-integrity.mjs`, so the root it derives from its
 * own location is `root` — the fixture, not this repository.
 */
function copyGate(root: string): string {
  const target = join(root, 'scripts', 'check-build-integrity.mjs');
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(REPO_ROOT, 'scripts', 'check-build-integrity.mjs'), target);
  return target;
}

/**
 * Run a gate copy. `cwd` is deliberately NOT set: the gate derives its root from
 * its own location, so an arm that only passed from one working directory would
 * be pinning the wrong thing.
 */
function runGate(gate: string): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [gate], { encoding: 'utf8', windowsHide: true });
}

describe('Scenario: integration — the gate walks the root it is copied into', () => {
  it(
    'when a nested emit is present, should accept the tree',
    () => {
      // given: a package whose top-level AND nested sources both have their emits
      // when:  the gate is run over it
      // then:  it exits 0, so the refusal beside it cannot be a tree that never matched
      const result = runGate(copyGate(gateTree()));

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );
});

describe('Scenario: a11y — the gate refuses a missing nested emit by name', () => {
  it(
    'when a nested emit is missing, should refuse and name the nested path',
    () => {
      // given: the same tree, with `dist/services/mut/report-loader.js` deleted
      // when:  the gate is run over it
      // then:  exit 1, naming the nested emit and the source it is built from
      //
      // The mutation two green gates failed to notice on the real repository.
      const root = gateTree();
      rmSync(join(root, 'packages', 'a', NESTED_EMIT), { force: true });

      const result = runGate(copyGate(root));

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('missing dist/services/mut/report-loader.js');
      expect(result.stderr).toContain('source: src/services/mut/report-loader.ts');
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );
});
