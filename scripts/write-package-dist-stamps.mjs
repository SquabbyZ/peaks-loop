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

import { writePackageDistStamps } from './packages-build-prerequisite.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

try {
  const packages = writePackageDistStamps(projectRoot);
  const names = Object.keys(packages);
  process.stdout.write(
    `package-dist-stamps: ${names.length} package(s) recorded (${names.join(', ')})\n`
  );
} catch (error) {
  process.stderr.write(
    `package-dist-stamps: FAILED to write the package stamps: ${error?.message ?? String(error)}\n`
  );
  process.exit(1);
}
