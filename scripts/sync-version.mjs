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

// 2026-07-22 follow-up (post-monorepo recurrence): automatically bump
// `peaks-loop-shared`'s own package.json version so the npm pack always
// ships a fresh tarball. Pre-monorepo this never recurred because the
// root was the only published artifact; in monorepo mode the shared
// subpackage's tarball gets cached on the registry with stale CLI_VERSION
// when only the root version changes, and `npm install` re-uses that
// cached tarball because peaks-loop<ver>'s package.json still pins
// `peaks-loop-shared@<old>`. Bumping the shared version forces a fresh
// tarball upload. Read-modify-write on the shared package's package.json
// only — the shared package is private, so its version field doesn't
// appear in any consumer's package.json (the peaks-loop dependency
// rewrite is still handled by the publish pack step).
//
// Skip the bump when the existing shared version is NOT a clean
// x.y.z SemVer (some test fixtures use markers like `9.9.9-oldsub`).
// In that case, leave the version alone and let the test that set
// the marker continue to work.
const sharedPkgPath = resolve('packages/peaks-loop-shared/package.json');
const sharedPkg = JSON.parse(readFileSync(sharedPkgPath, 'utf8'));
const sharedVersion = sharedPkg.version;
const sharedVersionMatch = /^(\d+)\.(\d+)\.(\d+)$/.exec(sharedVersion);
if (sharedVersionMatch) {
  const nextSharedVersion = `${sharedVersionMatch[1]}.${sharedVersionMatch[2]}.${Number(sharedVersionMatch[3]) + 1}`;
  sharedPkg.version = nextSharedVersion;
  writeFileSync(sharedPkgPath, JSON.stringify(sharedPkg, null, 2) + '\n');
  console.log(`[sync-version] bumped peaks-loop-shared ${sharedVersion} -> ${nextSharedVersion} (root ${version})`);
} else {
  console.log(`[sync-version] peaks-loop-shared version "${sharedVersion}" is not x.y.z; skipping auto-bump`);
}

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

