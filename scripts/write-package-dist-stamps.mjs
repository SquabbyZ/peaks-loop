#!/usr/bin/env node
// scripts/write-package-dist-stamps.mjs
//
// Record the content digest of every `packages/*/src`, so that
// `scripts/packages-build-prerequisite.mjs` can tell a `packages/*/dist` that
// was built from the current sources from one that was not.
//
// WHY IT IS A SEPARATE STEP FROM `scripts/write-dist-stamp.mjs`
//
// That script records the ROOT stamp and is the last step of the root build,
// after `tsc -p tsconfig.build.json`. The package builds happen EARLIER in the
// same chain (`pnpm -r --filter "./packages/*" run build`) and are what this
// script covers. Keeping them separate is what lets `pretest` stamp the
// packages without a root `dist/` existing at all — `write-dist-stamp.mjs`
// writes into `dist/`, and a `pretest` that has not run the root `tsc` has no
// `dist/` to write into.
//
// Both writers share one digest definition and one stamp version
// (`computeSourceDigest` / `DIST_STAMP_VERSION` in `scripts/dist-freshness.mjs`);
// only the destination differs, and it has to (see the header of
// `scripts/packages-build-prerequisite.mjs` for the `npm pack` measurements
// that rule out a per-package location).
//
// Non-zero exit only when the stamps could not be written at all: a build that
// cannot record what it built must not report success, because the guard
// downstream would then be unable to tell a stale `packages/*/dist` from a
// fresh one.
//
// "COULD NOT BE WRITTEN AT ALL" INCLUDES WRITING A RECORD OF NOTHING. With
// `packages/` present and holding no `src/`-bearing package this script used to
// write `{"packages":{}}`, print `0 package(s) recorded` and exit 0 — the
// writer's version of the silent green the guard refuses as
// `noPackagesMessage`, and unreachable by the guard's own remedy: a record of
// nothing cannot be told from "this root is not this repository". Measured
// 2026-09-25 (`backlog.md` §2.14 site 3), and this is the LAST step whose exit
// code can notice the state: step 3 (`pnpm -r --filter "./packages/*" run
// build`) is itself green at zero packages (measured, pnpm 10.11.0:
// `Scope: 0 of 1 workspace projects`, exit 0), step 5's root `tsc` compiles the
// root `src/` and succeeds, and step 7's `check-build-integrity.mjs` iterates
// zero package entries and prints `build-integrity: OK`. Refusing here stops
// the chain before 7 and 8.

import { writePackageDistStamps } from './packages-build-prerequisite.mjs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

try {
  const packages = writePackageDistStamps(projectRoot);
  const names = Object.keys(packages);
  if (names.length === 0) {
    const packagesDir = join(projectRoot, 'packages');
    process.stderr.write(
      [
        '',
        `package-dist-stamps: FAILED: no package under ${packagesDir} has a src/ to record.`,
        '',
        '  A record of no package is not a record: it cannot be told from "this',
        '  root is not this repository", and every package the guard downstream',
        '  does find would read `stale` for want of a digest. The guard refuses',
        '  this same state outright (`no workspace package ... has a src/`).',
        '',
        `  searched: ${packagesDir}`,
        '',
        '  Point this at a checkout of this repository, then re-run.',
        ''
      ].join('\n')
    );
    process.exit(1);
  }
  process.stdout.write(
    `package-dist-stamps: ${names.length} package(s) recorded (${names.join(', ')})\n`
  );
} catch (error) {
  process.stderr.write(
    `package-dist-stamps: FAILED to write the package stamps: ${error?.message ?? String(error)}\n`
  );
  process.exit(1);
}
