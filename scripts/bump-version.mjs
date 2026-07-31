#!/usr/bin/env node
/**
 * bump-version.mjs — pre-publish version bump for peaks-loop monorepo.
 *
 * Default policy: smallest semver unit (patch bit +1). The maintainer
 * 2026-07-22 explicit rule: "默认版本新增采用最小的版本位,除非我
 * 特意规划大版本" (default bump the smallest semver unit, unless
 * I explicitly plan a major release). This script enforces that.
 *
 * Inputs (priority order):
 *   1. CLI arg `--to <x.y.z>` — operator-specified target version
 *      (e.g. `--to 4.0.0-beta.27` for a normal patch bump, or
 *       `--to 4.0.0` for a major release the operator explicitly
 *       planned).
 *   2. env `PEAKS_NEXT_VERSION` — same as above.
 *   3. env `PEAKS_NEXT_MAJOR=<major>` (e.g. `4`) — bump the major
 *      bit and reset minor/patch to 0 (e.g. 4.0.0-beta.26 -> 5.0.0).
 *      This is the explicit "I plan a major release" code path.
 *   4. else: default policy = bump patch bit, preserve major/minor/
 *      prerelease (e.g. 4.0.0-beta.26 -> 4.0.0-beta.27,
 *      4.0.0 -> 4.0.1).
 *
 * After picking the target version, the script:
 *   1. Sets `package.json#version` to the target.
 *   2. Bumps EVERY publishable workspace package under `packages/`
 *      (8 today, discovered dynamically) in lockstep (AC6 of
 *      peaks-publish-stale-2026-07-23, widened monorepo-wide by
 *      rid-015) so that every workspace tarball shipped on the next
 *      publish carries a fresh version. Each package is
 *      `private: false` and its version is what `pnpm pack` rewrites
 *      the `workspace:*` dependency to — leaving any of them stale is
 *      the Layer 1 root cause of the 4.0.0-beta.35 → CLI_VERSION lag.
 *      Packages that are private, versionless, or carry a non-clean
 *      x.y.z version are skipped with a log line.
 *   3. Re-prints the new version on stdout (the publish workflow
 *      greps this for the git tag).
 *
 * Idempotency (AC7): if `package.json#version` already equals
 * `npm view peaks-loop dist-tags.latest`, the script exits 0 with
 * a no-op log line and does NOT bump any package. This stops the
 * publish workflow from re-running the auto-bump on a re-pushed tag
 * (which was the root cause of the 33 → 35 version-skip on npm).
 *
 * Stops with non-zero exit code on any parse / range error so the
 * publish workflow can fail fast.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

function parseArgs() {
  const args = process.argv.slice(2);
  let to;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--to') {
      to = args[i + 1];
      i++;
    }
  }
  return { to: to ?? process.env.PEAKS_NEXT_VERSION };
}

function parseSemVer(v) {
  // Matches x.y.z or x.y.z-prerelease
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(v);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ?? null, raw: v };
}

function bumpPatch(v) {
  const p = parseSemVer(v);
  if (!p) return null;
  if (!p.pre) {
    // Stable release: 4.0.0 -> 4.0.1
    return `${p.major}.${p.minor}.${p.patch + 1}`;
  }
  // Prerelease: 4.0.0-beta.26 -> 4.0.0-beta.27
  // The "prerelease" string may itself be dotted (e.g. "alpha.1"
  // or "beta.26"). The SemVer spec says the *first* dotted segment
  // is the leading identifier (alpha / beta / rc); numeric segments
  // are prerelease counters. Bump the trailing numeric segment by 1
  // (creating it if missing). "beta" -> "beta.1" (a new prerelease
  // series), "beta.26" -> "beta.27".
  const parts = p.pre.split('.');
  const last = parts[parts.length - 1];
  if (/^\d+$/.test(last)) {
    parts[parts.length - 1] = String(Number(last) + 1);
    return `${p.major}.${p.minor}.${p.patch}-${parts.join('.')}`;
  }
  // Non-numeric trailing segment (e.g. "alpha", "beta", "rc1") —
  // start a numeric counter.
  return `${p.major}.${p.minor}.${p.patch}-${p.pre}.1`;
}

function bumpMajor(v) {
  const p = parseSemVer(v);
  if (!p) return null;
  return p.pre ? `${p.major + 1}.0.0-${p.pre}` : `${p.major + 1}.0.0`;
}

// Read `npm view peaks-loop dist-tags.latest`. Returns null when
// the registry is unreachable (e.g. local dev with no network) so
// callers can treat it as "unknown — proceed with bump".
function registryLatest() {
  try {
    const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const out = execFileSync(
      npmBin,
      ['view', 'peaks-loop', 'dist-tags.latest', '--json'],
      { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' },
    ).toString();
    return JSON.parse(out);
  } catch {
    return null;
  }
}

// Bump ONE workspace subpackage's version in lockstep with root.
// Skipped when the package is private, carries no version, or its
// existing version is NOT a clean x.y.z SemVer (some test fixtures
// use markers like `9.9.9-oldsub`); in those cases, leave the
// manifest untouched. Always returns the (possibly unchanged)
// post-bump version so the caller can log it.
function bumpPackageVersion(pkgDir, rootNext) {
  const subPkgPath = resolve('packages', pkgDir, 'package.json');
  const subPkg = JSON.parse(readFileSync(subPkgPath, 'utf8'));
  const label = subPkg.name ?? pkgDir;
  const subVersion = subPkg.version;
  if (subPkg.private === true) {
    console.log(`[bump-version] ${label} is private; skipping auto-bump`);
    return subVersion;
  }
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(subVersion ?? '');
  if (!m) {
    console.log(`[bump-version] ${label} version "${subVersion}" is not x.y.z; skipping auto-bump`);
    return subVersion;
  }
  const nextSub = `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
  subPkg.version = nextSub;
  writeFileSync(subPkgPath, JSON.stringify(subPkg, null, 2) + '\n');
  console.log(`[bump-version] ${label} ${subVersion} -> ${nextSub} (root ${rootNext})`);
  return nextSub;
}

// Discover every workspace subpackage directory under packages/.
// A directory qualifies only when it directly contains a
// package.json — loose files (`.gitkeep`, `README.md`) and
// scratch directories are ignored. Sorted for deterministic log
// ordering. Returns [] when packages/ is absent.
function discoverPackageDirs() {
  const packagesRoot = resolve('packages');
  if (!existsSync(packagesRoot)) return [];
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(resolve(packagesRoot, entry.name, 'package.json')))
    .map((entry) => entry.name)
    .sort();
}

// Bump every publishable workspace subpackage in lockstep with root
// (rid-015). Previously only peaks-loop-shared was synchronized, so
// the other 7 publishable packages kept frozen versions and
// `pnpm pack` rewrote each `workspace:*` dependency to a stale pin —
// the same defect class as the 4.0.0-beta.35 CLI_VERSION lag, spread
// across 7 additional tarballs. Discovery is dynamic so adding or
// removing a package needs no edit here.
function bumpWorkspacePackages(rootNext) {
  const dirs = discoverPackageDirs();
  for (const dir of dirs) bumpPackageVersion(dir, rootNext);
  console.log(`[bump-version] synchronized ${dirs.length} workspace package(s) under packages/`);
}

const pkgPath = resolve('package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const current = pkg.version;
const { to } = parseArgs();

// AC7 idempotency: if current version is already published as
// dist-tags.latest, exit 0 BEFORE writing anything. This stops the
// publish workflow from re-running the auto-bump on a re-pushed
// tag and publishing a redundant version (the 33 -> 35 skip root
// cause).
const latestOnRegistry = registryLatest();
// AC7 idempotency: only short-circuit when the operator did NOT specify an
// explicit `--to <x.y.z>`. An explicit operator target always wins — even
// when it equals the current version (planned GA shape, e.g. 4.0.0 GA where
// root is already at 4.0.0 and the publish workflow passes `--to 4.0.0`)
// AND when it differs from the current version (republish-after-rollback
// shape, e.g. root=4.0.3 / registry=4.0.3 / operator wants 4.0.4). Without
// this guard, AC7 swallows operator intent silently.
if (latestOnRegistry === current && to === undefined) {
  console.log(`[bump-version] no-op: ${current} already on registry as latest; skipping bump`);
  process.exit(0);
}

let next;
if (to) {
  // Operator-specified target — must be a valid SemVer.
  if (!parseSemVer(to)) {
    console.error(`[bump-version] --to "${to}" is not a valid SemVer (x.y.z or x.y.z-pre)`);
    process.exit(1);
  }
  next = to;
} else if (process.env.PEAKS_NEXT_MAJOR) {
  next = bumpMajor(current);
  if (!next) {
    console.error(`[bump-version] current version "${current}" is not a valid SemVer`);
    process.exit(1);
  }
} else {
  // Default policy: smallest semver unit (patch bit +1).
  next = bumpPatch(current);
  if (!next) {
    console.error(`[bump-version] current version "${current}" is not a valid SemVer`);
    process.exit(1);
  }
}

// 2026-07-30 (4.0.0 GA root cause, part 2): an EXPLICIT target that
// already equals the current root version is NOT an error — it is the
// normal shape of a planned GA release. The operator bumps
// package.json to 4.0.0, commits, tags `v4.0.0`, and pushes; the
// publish workflow then resolves the tag to `--to 4.0.0`, which
// equals the current version. Previously this exited 1 and killed the
// run.
//
// The root manifest is already correct in that case, so we leave it
// alone — but the workspace subpackages must STILL be bumped in
// lockstep (AC6 / rid-015), because their versions are what
// `pnpm pack` writes into every `workspace:*` pin. Skipping them is
// exactly the stale-tarball defect class that AC6 exists to prevent.
//
// Without an explicit target (the default patch+1 path) an equal
// version genuinely means the bump computation produced nothing, so
// that case still fails loudly.
if (next === current) {
  if (to) {
    console.log(
      `[bump-version] root already at explicit target ${current}; leaving root manifest untouched`,
    );
    bumpWorkspacePackages(current);
    console.log(`[bump-version] peaks-loop ${current} -> ${current} (root unchanged, subpackages bumped)`);
    process.exit(0);
  }
  console.error(`[bump-version] no-op: target version equals current version ${current}`);
  process.exit(1);
}

// AC6: shared always bumped in lockstep with root. No env gate —
// the env gate was the Layer 2 root cause (local dev builds
// produced stale shared tarballs because publish.yml set the env
// only on the CI Build step). bump-version.mjs is now the single
// owner of the shared/package.json#version bump.
//
// rid-015 widens AC6 from shared-only to EVERY publishable package
// under packages/ (8 today), for the same reason: any package left
// frozen ships a stale `workspace:*` pin on the next publish.
pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

bumpWorkspacePackages(next);

console.log(`[bump-version] peaks-loop ${current} -> ${next}`);