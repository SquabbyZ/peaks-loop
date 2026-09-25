// tests/unit/scripts/write-package-dist-stamps-cli.test.ts
//
// `scripts/write-package-dist-stamps.mjs` — the CLI entry point, EXECUTED.
// `packages-build-stamp-write.test.ts` pins the write it wraps; this file pins
// its EXIT CODE, which is a different contract and the one thing a function
// test cannot reach.
//
// THE DEFECT, measured 2026-09-25 on a root with `packages/` present and no
// src-bearing package: the script wrote `{ "version": 1, "packages": {} }`,
// printed `package-dist-stamps: 0 package(s) recorded ()` and exited **0**
// (`backlog.md` §2.14 site 3, "the writer's version of F2b"). Its own header
// already stated the contract that path broke — "Non-zero exit only when the
// stamps could not be written at all: a build that cannot record what it built
// must not report success" — and the guard downstream refuses the identical
// state outright (`no workspace package ... has a src/`).
//
// WHY ITS OWN FILE, and why the arms run a COPY of the script: the script
// imports its sibling module by relative path and derives its project root from
// its OWN location (`resolve(dirname(fileURLToPath(import.meta.url)), '..')`),
// with no root override, so it cannot be pointed at a fixture. Copying the
// three shipped modules into `<fixture>/scripts/` makes that fixture the root it
// walks — the same shape, and for the same reason, as
// `check-build-integrity.test.ts` — and the copy is taken at RUN TIME from the
// shipped bytes, so no arm can drift from the text it asserts.
//
// The sequencing that makes this the right place to refuse: `pnpm -r --filter
// "./packages/*" run build` (step 3, the step BEFORE this one) is itself green
// at zero packages — measured 2026-09-25 with this repository's pnpm 10.11.0:
// `Scope: 0 of 1 workspace projects`, exit 0. Step 5's root `tsc` compiles the
// root `src/` and succeeds, and step 7's `check-build-integrity.mjs` iterates
// zero package entries and prints `build-integrity: OK`. So a `packages/` that
// holds nothing walks the whole chain green; this writer is the last step whose
// exit code can say the package set is empty, and it precedes 7 and 8.
//
// Two arms, because the refusal must be narrow: the second half proves the
// ordinary tree still records and exits 0, so the first cannot be satisfied by
// breaking the script for everyone.
//
// What reddens arm 1: delete the `names.length === 0` refusal from
// `scripts/write-package-dist-stamps.mjs` — the script then exits 0 over a
// `{"packages":{}}` stamp file and the arm reads status 0.
//
// Dimensions: `render` is omitted (this file asserts the exit status, the
// message and the file written — never the success line's rendering) and
// `behavior` is omitted (a CLI entry point returns nothing and holds no state;
// its verdict IS the exit status, asserted under `a11y` and `integration`).

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { fixture, REPO_ROOT } from '../_setup/packages-build-fixture.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

declareDimensions(
  'tests/unit/scripts/write-package-dist-stamps-cli.test.ts',
  ['integration', 'a11y'],
  [
    {
      dim: 'render',
      reason:
        'the exit status, the message and the file written are asserted; the success line is not'
    },
    {
      dim: 'behavior',
      reason:
        'a CLI entry point returns nothing and holds no state — its verdict IS the exit status, asserted under a11y'
    }
  ]
);

/**
 * The script's own three modules, copied into `root/scripts/`, so `root` is the
 * project root the script resolves for itself. Taken from the shipped files at
 * run time.
 */
function withScripts(root: string): string {
  const scripts = join(root, 'scripts');
  mkdirSync(scripts, { recursive: true });
  for (const name of [
    'packages-build-prerequisite.mjs',
    'dist-freshness.mjs',
    'write-package-dist-stamps.mjs'
  ]) {
    copyFileSync(join(REPO_ROOT, 'scripts', name), join(scripts, name));
  }
  return join(scripts, 'write-package-dist-stamps.mjs');
}

function runStamps(root: string): SpawnSyncReturns<string> {
  return spawnSync('node', [join(root, 'scripts', 'write-package-dist-stamps.mjs')], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: SUBPROCESS_TEST_TIMEOUT_MS
  });
}

// ── integration: the empty package set ───────────────────────────────

describe('Scenario: integration — a packages/ directory with nothing to record', () => {
  it('when packages/ holds no src-bearing package, should refuse rather than record an empty stamp', () => {
    // given: a root whose `packages/` is PRESENT and empty of src-bearing entries — the shape that reads the same as "this is not the repository"
    // when: the stamp writer is run
    // then: it exits non-zero and names the directory it searched, instead of writing a record of nothing and reporting success
    const root = fixture({});
    mkdirSync(join(root, 'packages', 'not-a-package'), { recursive: true });
    withScripts(root);

    const result = runStamps(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(join(root, 'packages'));
    expect(result.stderr).toContain('no package');
  });
});

// ── a11y: the ordinary tree is untouched ─────────────────────────────

describe('Scenario: a11y — the ordinary tree still records and reports success', () => {
  it('when packages/ holds a src-bearing package, should record it and exit 0', () => {
    // given: the ordinary fixture root, with one package carrying a source
    // when: the stamp writer is run
    // then: it exits 0 and the stamp file it wrote names that package, so the refusal above is narrow
    const root = fixture({ a: 'export const a = 1;\n' });
    withScripts(root);

    const result = runStamps(root);

    expect(result.status).toBe(0);
    // The stamp's schema is DECLARED at this untyped boundary rather than
    // inferred; what enforces it is the exact key set asserted below.
    const stamp = JSON.parse(readFileSync(join(root, 'packages', '.dist-stamps.json'), 'utf8')) as {
      packages: Record<string, unknown>;
    };
    expect(Object.keys(stamp.packages)).toEqual(['a']);
  });
});
