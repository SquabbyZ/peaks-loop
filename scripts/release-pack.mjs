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
import { mkdtempSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

import {
  runPnpm,
  runNpm,
  verifyTarball,
  toPosixPath,
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

// 2026-07-23 follow-up (peaks-publish-stale fix, AC5): when the
// LOCAL tarball is missing `package/dist/version.js`, fail-loud
// instead of returning null/false. The prior `null && regVer` short
// circuit caused the silent SKIP that let stale CLI_VERSION tarballs
// onto npm — peaks-loop@<new> shipping peaks-loop-shared@<new> with
// NO version.js file at all. We refuse to publish such a tarball;
// the upstream publish.yml `gate-cli-version` step is the parallel
// gate for the on-disk state, this is the tarball-level gate.
function isRegistryStale(name, version, localTarball) {
  const tmp = mkdtempSync(join(os.tmpdir(), 'peaks-stale-'));
  try {
    // Local tarball may not ship `dist/version.js` (e.g.
    // peaks-loop-shared-channel has no CLI_VERSION export). The
    // staleness check only applies to packages that carry a
    // version.js file. Use the silent helper that returns null on
    // missing file instead of throwing.
    const localVer = readVersionJsFromTarballSilent(localTarball, `local ${name}@${version}`);
    if (localVer === null) return false;
    const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    execFileSync(npmBin, ['pack', `${name}@${version}`, '--pack-destination', tmp], {
      cwd: projectRoot, stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    const tgz = readdirSync(tmp).find(f => f.endsWith('.tgz'));
    if (!tgz) {
      // No registry tarball yet (first publish of this version).
      // Not "stale" — there is nothing to compare against. Return
      // false so the publish proceeds.
      return false;
    }
    const regVer = readVersionJsFromTarballSilent(join(tmp, tgz), `registry ${name}@${version}`);
    if (regVer === null) return false;
    return localVer !== regVer;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// Silent counterpart of `readVersionJsFromTarball`: returns null
// (instead of throwing) when `package/dist/version.js` is missing
// or when tar extraction fails. Used by `isRegistryStale` for
// packages that don't ship a CLI_VERSION file (peaks-loop-shared-
// channel, -job-snapshot, -mut, -doctor, -crystallization,
// -final-review, -audit-independent).
function readVersionJsFromTarballSilent(tarball, label) {
  const tmp = mkdtempSync(join(os.tmpdir(), 'peaks-version-silent-'));
  try {
    execFileSync('tar', ['-xzf', toPosixPath(tarball), '-C', toPosixPath(tmp)]);
    const f = join(tmp, 'package', 'dist', 'version.js');
    if (!existsSync(f)) return null;
    return readFileSync(f, 'utf8');
  } catch { return null; }
  finally { rmSync(tmp, { recursive: true, force: true }); }
}

// Read `package/dist/version.js` out of a tarball. Throws when the
// file is missing — the publish gate (AC1, AC5) refuses to ship a
// tarball without it. Used by `isRegistryStale` and `publishOne`'s
// post-pack gate so the tarball content is the source of truth, not
// the on-disk file. The Windows path conversion (`toPosixPath`) is
// required — GNU tar on Windows misreads `C:\Users\…` as a remote
// host spec. The shared helper does the canonical conversion.
function readVersionJsFromTarball(tarball, label) {
  const tmp = mkdtempSync(join(os.tmpdir(), 'peaks-version-'));
  try {
    execFileSync('tar', ['-xzf', toPosixPath(tarball), '-C', toPosixPath(tmp)]);
    const f = join(tmp, 'package', 'dist', 'version.js');
    if (!existsSync(f)) {
      throw new Error(
        `[release-pack] ${label} tarball is missing package/dist/version.js — refusing to publish. ` +
        `Layer 3 root cause: shared tsc incremental build silently skipped dist/version.js. ` +
        `See .peaks/memory/peaks-stale-cli-version-2026-07-23-diagnosis.md`,
      );
    }
    return readFileSync(f, 'utf8');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// AC1/AC4 helper: pack the workspace package and extract
// `package/dist/version.js` from the resulting tarball ONLY for
// `peaks-loop-shared` (the only subpackage that ships a CLI_VERSION
// file — others are pure utility packages). Returns
// `{ tarball, cliVersion? }` so callers can decide whether the
// packed content matches the expected CLI_VERSION. Fail-loud when
// the shared tarball is missing `dist/version.js` — that mirrors
// the publish.yml gate and catches the Layer 3 (silent tsc skip)
// case before npm publish.
function packAndInspectTarball(pkgDir) {
  const spec = readPackage(pkgDir);
  runPnpm(['pack', '--pack-destination', tarballDir], {
    cwd: resolve(projectRoot, pkgDir),
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const tarballName = `${spec.name.replace('@', '').replace(/\//g, '-')}-${spec.version}.tgz`;
  const tarball = join(tarballDir, tarballName);
  if (spec.name === 'peaks-loop-shared') {
    const cliVersion = readVersionJsFromTarball(tarball, `local ${spec.name}@${spec.version}`);
    return { tarball, name: spec.name, version: spec.version, cliVersion };
  }
  return { tarball, name: spec.name, version: spec.version };
}

function publishOne(pkgDir, internalPackages) {
  const packed = packAndInspectTarball(pkgDir);
  const { tarball, name, version } = packed;
  const cliVersion = packed.cliVersion;
  const cliLabel = cliVersion !== undefined ? ` (CLI_VERSION from tarball: ${extractCliVersion(cliVersion) ?? '<unparseable>'})` : '';
  console.log(`[release-pack] packed ${name}@${version} -> ${tarball}${cliLabel}`);
  const verdict = verifyTarball(tarball, name, version, internalPackages);
  if (!verdict.ok) {
    throw new Error(
      `[release-pack] ${name}@${version} failed verification:\n  - ${verdict.errors.join('\n  - ')}`,
    );
  }
  // AC1 structural gate: the packed CLI_VERSION must equal the
  // ROOT version (4.0.0-beta.N), not the local package.json
  // version. Only applies to packages that ship a CLI_VERSION
  // file (peaks-loop-shared). Why: peaks-loop imports CLI_VERSION
  // from peaks-loop-shared; the shared package's own
  // package.json#version (e.g. 0.0.25) is the npm-pack pin target
  // but is irrelevant to downstream consumers — what matters is
  // that shared's `dist/version.js` carries the LATEST root
  // version stamp. This catches the Layer 3 (silent tsc skip)
  // case BEFORE npm publish.
  if (cliVersion !== undefined) {
    const rootVersion = readPackage('.').version;
    const packedCli = extractCliVersion(cliVersion);
    if (packedCli !== rootVersion) {
      throw new Error(
        `[release-pack] ${name}@${version} tarball CLI_VERSION does not match root version. ` +
        `tarball=${packedCli ?? '<unparseable>'}, expected=${rootVersion} (root). ` +
        `Refusing to publish a stale tarball.`,
      );
    }
  }
  if (process.env.PEAKS_DRY_RUN === '1') {
    console.log(`[release-pack] DRY RUN: would publish ${name}@${version}`);
    return;
  }
  if (isAlreadyPublished(name, version) && !isRegistryStale(name, version, tarball)) {
    console.log(`[release-pack] SKIP ${name}@${version} (already on registry)`);
    return;
  }
  if (isAlreadyPublished(name, version) && isRegistryStale(name, version, tarball)) {
    console.log(`[release-pack] RE-PUBLISH ${name}@${version} (registry CLI_VERSION is stale)`);
  }
  console.log(`[release-pack] publishing ${name}@${version} via npm OIDC ...`);
  runNpm(['publish', tarball, '--tag=latest', '--provenance=true'], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
  console.log(`[release-pack] OK ${name}@${version}`);
}

// Extract the literal CLI_VERSION value out of a `dist/version.js`
// blob. Returns null on parse failure so callers can surface a
// clear error instead of an opaque object equality check.
function extractCliVersion(blob) {
  const m = /CLI_VERSION\s*=\s*("([^"]*)"|'([^']*)')/.exec(blob ?? '');
  if (!m) return null;
  return m[2] ?? m[3] ?? null;
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

// Module exports for regression tests in tests/unit/release/. The
// direct-invocation guard above ensures main() does NOT run when
// imported, so the helper functions are safe to surface for AC1 /
// AC5 / AC7 test coverage.
export {
  readVersionJsFromTarball,
  packAndInspectTarball,
  isRegistryStale,
  extractCliVersion,
  SUBPACKAGE_DIRECTORIES,
  ROOT_DIR,
};
