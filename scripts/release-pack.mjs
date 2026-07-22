#!/usr/bin/env node
/**
 * release-pack.mjs — Dependency-safe, OIDC-friendly workspace publish.
 *
 * Root cause: `npm publish` against a pnpm workspace package
 * directory serializes the manifest verbatim, leaking the
 * pnpm-only `workspace:*` protocol on every internal dep into
 * the registry. The next consumer install (`npm i -g peaks-loop`)
 * fails to resolve any of the eight internal packages.
 *
 * Fix: pack each workspace package with `pnpm pack` (which
 * rewrites `workspace:*` to exact version pins matching the local
 * manifest), inspect the result, then publish via `npm publish
 * <tarball>`. npm 11+ OIDC Trusted Publishing remains in effect
 * because the tarball is just a file argument.
 *
 * Invocation (env vars):
 *   PEAKS_DRY_RUN=1      pack + verify only; do not publish
 *   PEAKS_SKIP=sub       publish root only (skip subpackages)
 *   PEAKS_SKIP=root      publish subpackages only (skip root)
 *   PEAKS_KEEP_TARBALLS=1 keep staged tarballs for QA inspection
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  runPnpm,
  runNpm,
  verifyTarball,
} from './_release-shared.mjs';

const projectRoot = resolve(fileURLToPath(import.meta.url), '..', '..');

// Dependency-safe publish order: `peaks-loop-shared` publishes
// first; dependents follow; root `peaks-loop` publishes last.
const SUBPACKAGE_DIRECTORIES = [
  'packages/peaks-loop-shared',
  'packages/peaks-loop-shared-channel',
  'packages/peaks-loop-job-snapshot',
  'packages/peaks-loop-mut',
  'packages/peaks-loop-doctor',
  'packages/peaks-loop-crystallization',
  'packages/peaks-loop-final-review',
  'packages/peaks-loop-audit-independent',
];
const ROOT_DIR = '.';

function readPackage(pkgDir) {
  return JSON.parse(readFileSync(resolve(projectRoot, pkgDir, 'package.json'), 'utf8'));
}

function listInternalPackages() {
  return SUBPACKAGE_DIRECTORIES.map((d) => ({ name: readPackage(d).name, version: readPackage(d).version }));
}

// Stage under os.tmpdir() via mkdtemp; auto-clean unless
// PEAKS_KEEP_TARBALLS=1.
const tarballDir = mkdtempSync(join(os.tmpdir(), 'peaks-release-pack-'));
let cleanupDone = false;
function cleanup() {
  if (cleanupDone) return;
  cleanupDone = true;
  if (process.env.PEAKS_KEEP_TARBALLS === '1') return;
  try { rmSync(tarballDir, { recursive: true, force: true }); } catch { /* tmpdir reclaim */ }
}

function packOne(pkgDir) {
  const spec = readPackage(pkgDir);
  runPnpm(['pack', '--pack-destination', tarballDir], {
    cwd: resolve(projectRoot, pkgDir),
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const tarballName = `${spec.name.replace('@', '').replace(/\//g, '-')}-${spec.version}.tgz`;
  return { tarball: join(tarballDir, tarballName), name: spec.name, version: spec.version };
}

function isAlreadyPublished(name, version) {
  // Probe npmjs for an existing version of `name`. The CI runner
  // is a fresh container; the `npm view` call goes over OIDC-
  // compatible public registry egress and does NOT require any
  // write access. We return true when the version is already on
  // the registry so the publish step can be skipped; otherwise
  // the npm CLI rejects `npm publish <same version>` with the
  // "cannot publish over the previously published versions" error.
  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const probe = spawnSync(npmBin, ['view', `${name}@${version}`, 'version', '--json'], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  if (probe.status !== 0) return false;
  const stdout = probe.stdout?.toString?.() ?? '';
  return /"\d+\.\d+\.\d+/.test(stdout) || /\d+\.\d+\.\d+/.test(stdout);
}

function publishOne(pkgDir, internalPackages) {
  const { tarball, name, version } = packOne(pkgDir);
  console.log(`[release-pack] packed ${name}@${version} -> ${tarball}`);
  const verdict = verifyTarball(tarball, name, version, internalPackages);
  if (!verdict.ok) {
    throw new Error(
      `[release-pack] ${name}@${version} failed verification:\n  - ${verdict.errors.join('\n  - ')}`,
    );
  }
  if (process.env.PEAKS_DRY_RUN === '1') {
    console.log(`[release-pack] DRY RUN: would publish ${name}@${version}`);
    return;
  }
  if (isAlreadyPublished(name, version)) {
    console.log(`[release-pack] SKIP ${name}@${version} (already on registry)`);
    return;
  }
  console.log(`[release-pack] publishing ${name}@${version} via npm OIDC ...`);
  runNpm(['publish', tarball, '--tag=latest', '--provenance=true'], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
  console.log(`[release-pack] OK ${name}@${version}`);
}

function main() {
  const internalPackages = listInternalPackages();
  const skipRoot = process.env.PEAKS_SKIP === 'root';
  const skipSub = process.env.PEAKS_SKIP === 'sub';

  // Rebuild the workspace tarballs from the current tree BEFORE
  // packing. The upstream CI Build step also runs `pnpm run build`,
  // but `release-pack.mjs` may run in a shell where that build was
  // a different process (e.g. on a runner where the worktree was
  // re-checked-out, or locally without a previous build). Re-running
  // the build here guarantees peaks-loop-shared/dist/version.js etc.
  // carry the current root version stamp (4.0.0-beta.18) rather
  // than a stale 4.0.0 from a previous build. Safe to run when the
  // dist already exists: tsc simply overwrites the .js / .d.ts
  // files in place.
  if (process.env.PEAKS_SKIP_BUILD !== '1') {
    console.log('[release-pack] running pnpm run build to refresh dist/');
    runPnpm(['run', 'build'], { cwd: projectRoot, stdio: 'inherit' });
  }

  try {
    if (!skipSub) {
      for (const subDir of SUBPACKAGE_DIRECTORIES) publishOne(subDir, internalPackages);
    }
    if (!skipRoot) publishOne(ROOT_DIR, internalPackages);
  } finally {
    cleanup();
  }
  console.log('[release-pack] DONE');
}

// Direct-invocation guard. We compare `pathToFileURL(process.argv[1])`
// against `import.meta.url` so the script's main() does NOT run
// when a test or another module imports `release-pack.mjs` for
// side-effect-free access to exports. This is the canonical
// ESM equivalent of `if __name__ == "__main__"` and works on
// Node 20 LTS (the project's `engines.node` floor) through the
// latest LTS — we deliberately avoid `import.meta.main` which is
// only present on Node 22.6+.
function isDirectInvocation() {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(process.argv[1]).href === import.meta.url;
  } catch {
    return false;
  }
}
if (isDirectInvocation()) {
  try {
    main();
  } catch (err) {
    console.error(`[release-pack] ABORT: ${err?.message ?? err}`);
    cleanup();
    process.exit(1);
  }
}
