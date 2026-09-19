#!/usr/bin/env node
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
const version = packageJson.version;

if (typeof version !== 'string' || version.length === 0) {
  throw new Error('package.json version must be a non-empty string');
}

// Emitted SINGLE-quoted, not via `JSON.stringify`. `JSON.stringify` quotes with
// `"`, and the repo's own prettier config (`package.json#prettier`,
// `singleQuote: true`) is what the husky gate runs over this tracked file — so a
// double-quoted emit made `prettier --check` fail on version.ts after every run.
// This script runs in `build` / `prepack` / `prepublish` / `pretest`, so every
// build dirtied a tracked file against a `prettierUnformatted` ceiling of 0
// (reproduced + fixed in slice S5a, 2026-09-19). A version that cannot be
// written as a single-quoted TS literal throws instead of being escaped: the
// alternative is silently emitting broken source, which is the same failure the
// RUNTIME_VERSION writer below refuses with a throw.
if (/['\\\r\n]/.test(version)) {
  throw new Error(`package.json version cannot be emitted as a single-quoted literal: ${version}`);
}

// Slice 3a — version.ts lives in the peaks-loop-shared workspace package.
// The shared package is `private: true` and is consumed via workspace:*,
// so its own package.json `version` field is irrelevant for downstream
// consumers; we always emit the main peaks-loop version.
writeFileSync(
  resolve('packages/peaks-loop-shared/src/version.ts'),
  `export const CLI_VERSION = '${version}';\n`
);

// Slice 2026-09-11 (runtime-version-lockstep) — sync RUNTIME_VERSION.
// `packages/peaks-loop-internal-runtime/src/index.ts` declares
// `RUNTIME_VERSION` under a comment stating it tracks the peaks-loop root
// version, but nothing wrote it: v4.0.37 was tagged with the constant still
// at 4.0.36 and publish.yml's gate-cli-version step aborted before npm
// publish. The literal is replaced in place, single-quoted — the exact
// shape the gate greps — because the file also holds the package's public
// exports and must never be regenerated wholesale. A literal we cannot
// find throws instead of no-op'ing: that silence is how the drift reached CI.
const runtimeIndexPath = resolve('packages/peaks-loop-internal-runtime/src/index.ts');
const runtimeIndex = readFileSync(runtimeIndexPath, 'utf8');
const runtimeDecl = /(export const RUNTIME_VERSION = ')[^']*(';)/;
if (!runtimeDecl.test(runtimeIndex)) {
  throw new Error(`${runtimeIndexPath}: could not find "export const RUNTIME_VERSION = '...';"`);
}
const syncedRuntimeIndex = runtimeIndex.replace(runtimeDecl, `$1${version}$2`);
if (syncedRuntimeIndex !== runtimeIndex) {
  writeFileSync(runtimeIndexPath, syncedRuntimeIndex);
}

// 2026-07-23 follow-up (peaks-publish-stale fix, AC6): the shared
// bump used to live here, gated on `PEAKS_AUTO_BUMP_SHARED === '1'`.
// That gate was the Layer 2 root cause: publish.yml set the env on
// the CI Build step, but local dev runs (and any path that didn't
// re-export the env) produced stale shared tarballs. The bump now
// lives in `scripts/bump-version.mjs` (which always runs when root
// version changes) and `bump-version.mjs` is the single owner of
// the shared/package.json#version bump.
//
// This script keeps a fallback shared bump when explicitly invoked
// from another path with `PEAKS_AUTO_BUMP_SHARED === '1'` — that
// preserves the contract for any out-of-band build invocation that
// still sets the env var. The bump-version.mjs path is primary and
// always-on; the gate here is just a back-stop.

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

// Slice 2026-07-30 — the targeted unlink above is now a
// regression-test pin for Bug-04; the load-bearing dist
// invalidation moved up to `clean-dist.mjs`, which wipes every
// packages/*/dist wholesale before any subpackage build runs.
// This narrow unlink stays because catching the Bug-04 lineage
// on its own is cheap insurance against future pipeline
// reorderings.
//
// E2 (rid 2026-09-17-cli-output-and-stale-refs) — the sentence
// that stood here named a unit test as covering this unlink. That
// test (file name only, deliberately not spelled as a path: it was
// deleted in `f17aa377`, "delete 559 legacy unit tests", and a
// path-shaped token would read as a live citation to the guard
// that now checks these comments) is `sync-version-invalidation.test.ts`
// — so the coverage this paragraph claimed has not existed since.
//
// What DOES cover this script today, verified rather than
// assumed: the version lockstep tests pin its two outputs to the
// root package.json#version — `CLI_VERSION` in
// packages/peaks-loop-shared/src/version.ts, and the
// `RUNTIME_VERSION` emit added in slice 2026-09-11 plus the built
// shared dist/version.js. Both read the artifacts, so they catch a
// silent no-op in either writer. They are indirect pins, and they
// are the reason a broken emit cannot ship.
//
// NOT COVERED, recorded rather than hidden: the unlink itself has
// no direct pin. No test executes this script, so nothing asserts
// that a stale packages/peaks-loop-shared/dist/version.js is
// actually removed. If you need the unlink pinned, that test has
// to be written — the one named here no longer exists.
