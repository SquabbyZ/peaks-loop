#!/usr/bin/env node
// scripts/write-dist-stamp.mjs
//
// Last step of `npm run build`: record the content digest of the sources that
// `tsc -p tsconfig.build.json` just compiled into `dist/`.
//
// The stamp is what lets the integration suite answer "was this `dist/` built
// from the `src/` I am looking at?" EXACTLY, instead of guessing from mtimes
// (`scripts/dist-freshness.mjs` explains the comparison and why identity is the
// authority with mtime only as a fallback).
//
// It runs LAST so the digest covers the sources in their final state, and
// `scripts/clean-dist.mjs` wipes `dist/` first, so the stamp is always
// regenerated rather than inherited. It is not published: `package.json#files`
// admits only `dist/**/*.js|.d.ts|.md|.sql`.
//
// Non-zero exit is deliberate and only reachable when the stamp could not be
// written at all — a build that cannot record what it built must not report
// success, because the guard downstream would then be unable to tell a stale
// `dist/` from a fresh one.

import { writeDistStamp } from './dist-freshness.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

try {
  const { digest, fileCount } = writeDistStamp(projectRoot);
  process.stdout.write(`dist-stamp: ${fileCount} source file(s), digest ${digest.slice(0, 12)}\n`);
} catch (error) {
  process.stderr.write(`dist-stamp: FAILED to write dist/.dist-stamp.json: ${error?.message ?? String(error)}\n`);
  process.exit(1);
}
