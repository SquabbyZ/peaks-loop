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
 *   2. Re-prints the new version on stdout (the publish workflow
 *      greps this for the git tag).
 *
 * Stops with non-zero exit code on any parse / range error so the
 * publish workflow can fail fast.
 */

import { readFileSync, writeFileSync } from 'node:fs';
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

const pkgPath = resolve('package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const current = pkg.version;
const { to } = parseArgs();

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

if (next === current) {
  console.error(`[bump-version] no-op: target version equals current version ${current}`);
  process.exit(1);
}

pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

console.log(`[bump-version] peaks-loop ${current} -> ${next}`);
