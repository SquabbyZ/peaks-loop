#!/usr/bin/env node
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
const version = packageJson.version;

if (typeof version !== 'string' || version.length === 0) {
  throw new Error('package.json version must be a non-empty string');
}

// Slice 3a — version.ts lives in the peaks-loop-shared workspace package.
// The shared package is `private: true` and is consumed via workspace:*,
// so its own package.json `version` field is irrelevant for downstream
// consumers; we always emit the main peaks-loop version.
writeFileSync(
  resolve('packages/peaks-loop-shared/src/version.ts'),
  `export const CLI_VERSION = ${JSON.stringify(version)};\n`,
);

// 2026-07-22 follow-up (Bug-04 root-cause fix): the previous version of
// this script wrote `version.ts` only, then handed off to `tsc`. Tsc's
// incremental-build cache compares `version.ts` only by mtime + size —
// and the freshly-written version.ts has the SAME size as before, so tsc
// reported "no changes" and skipped emitting `dist/version.js`. The
// pre-existing `dist/version.js` (from a prior build with an OLD CLI_VERSION)
// was then re-packed by `release-pack.mjs` into the npm tarball, causing
// downstream `peaks -v` to print the wrong version.
//
// Fix: invalidate the shared `dist/version.js` (and its .d.ts / .map) so a
// subsequent `tsc -p tsconfig.json` on the shared subpackage has to regen it.
// This is idempotent: if no dist yet exists, noop; if it exists, unlink.
for (const ext of ['js', 'd.ts', 'd.ts.map']) {
  const sharedDist = resolve('packages/peaks-loop-shared/dist/version.' + ext);
  if (existsSync(sharedDist)) {
    unlinkSync(sharedDist);
  }
}

