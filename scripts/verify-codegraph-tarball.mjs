#!/usr/bin/env node
// scripts/verify-codegraph-tarball.mjs
//
// rid-CG-005 — Tarball verify CI guard (self + downstream).
//
// Root cause being closed: peaks-loop@4.0.20 ships
// `dist/services/codegraph/*.js` in its published tarball
// (verified 2026-08-11, 911 files / 11625 nodes). If a future
// PR mutates `package.json#files[]` and accidentally drops
// the `dist/**/*.js` wildcard, the codegraph service
// disappears from the consumer tarball — silently. The
// downstream consumer still gets the CLI command group
// (`peaks codegraph …`) but the service files are absent,
// and `peaks codegraph init` will throw ERR_MODULE_NOT_FOUND
// the moment it touches the missing codegraph-service.js.
//
// This script runs `npm pack --dry-run --json` against the
// peaks-loop root and asserts the tarball contains at least
// one file under `dist/services/codegraph/`. Exit 0 = OK,
// exit 1 = whitelist is broken.
//
// Usage:
//   node scripts/verify-codegraph-tarball.mjs
//
// The script reads `package.json` from `process.cwd()` (the project
// being verified) — pass `--project <path>` or chdir first. This
// makes the script reusable as a generic verify-on-publish guard.
//
// Why `npm pack --dry-run --json` instead of `tar -tzf <tgz>`?
// Because the tarball only exists after `npm pack`, which
// runs `prepack` → `npm run build` and can take 60-180 s on
// a cold machine. `--dry-run --json` skips the actual pack
// and returns the same file list as a JSON array — fast
// (sub-second) and side-effect free.
//
// Why verify at all if `dist/**/*.js` is already in
// `package.json#files[]`? Because the whitelist is text; it
// has no type-level guarantee. The verify step is the only
// thing standing between a typo'd whitelist and a broken
// downstream consumer.

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const REQUIRED_PREFIX = 'dist/services/codegraph/';
const REQUIRED_AT_LEAST_ONE = true;

function fail(message) {
  process.stderr.write(`verify-codegraph-tarball: ${message}\n`);
  process.exit(1);
}

function runNpmPackDryRun() {
  // `npm pack --dry-run --json` writes the JSON payload to
  // stdout; --pack-destination is irrelevant because dry-run
  // does not write a tgz. cwd = repoRoot so the package.json
  // the script reads is peaks-loop's own.
  //
  // `--ignore-scripts` skips the `prepack` build pipeline
  // (~120 s on a cold machine) so the verify stays sub-second
  // and side-effect free. The dry-run output is purely
  // declarative — the file list comes from package.json#files
  // + the on-disk tree, not from the prepack hook.
  //
  // `shell: true` lets Windows resolve `npm.cmd` via PATHEXT
  // (otherwise `spawnSync('npm', …)` raises ENOENT on Windows
  // because there is no `npm.exe` — only `npm.cmd`).
  const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });

  if (result.error) {
    fail(`npm pack --dry-run failed to spawn: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const stderr = result.stderr ? result.stderr.trim() : '';
    fail(`npm pack --dry-run exited with status ${result.status}: ${stderr}`);
  }

  return result.stdout;
}

function parseFileList(stdout) {
  // npm pack --dry-run --json emits different shapes across
  // npm versions. We accept all known shapes:
  //   (a) [{ "filename": "..." }]               — npm 7+
  //   (b) [{ "id": "...", "files": [{ "path": "..." }] }]
  //                                            — npm 10.x (the
  //                                            current shape).
  //   (c) [{ "files": [...] }]                  — generic.
  //   (d) ["..."]                               — legacy string list.
  const trimmed = stdout.trim();
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    fail(`npm pack --dry-run --json output was not valid JSON: ${error.message}`);
    return [];
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return [];
  }

  const collected = [];
  for (const entry of parsed) {
    if (typeof entry === 'string') {
      collected.push(entry);
      continue;
    }
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    // Modern npm 10.x emits BOTH `filename` (the tarball name) AND
    // `files[]` (the actual payload). Fall through to also collect
    // the inner files array — otherwise the `filename` early-return
    // silently drops the 1500+ entries we actually want to verify.
    if (typeof entry.filename === 'string' && entry.filename.endsWith('.tgz')) {
      // Top-level tarball identifier (e.g. "peaks-loop-4.0.20.tgz");
      // not a payload path, so we skip it and continue to `files`.
    } else if (typeof entry.filename === 'string') {
      collected.push(entry.filename);
      continue;
    }
    if (Array.isArray(entry.files)) {
      for (const inner of entry.files) {
        if (typeof inner === 'string') {
          collected.push(inner);
        } else if (inner && typeof inner.path === 'string') {
          collected.push(inner.path);
        }
      }
    }
  }
  return collected;
}

function filterCodegraphServiceFiles(files) {
  return files.filter((file) => typeof file === 'string' && file.startsWith(REQUIRED_PREFIX));
}

function main() {
  const stdout = runNpmPackDryRun();
  const files = parseFileList(stdout);
  const codegraphFiles = filterCodegraphServiceFiles(files);

  if (codegraphFiles.length === 0 && REQUIRED_AT_LEAST_ONE) {
    fail(
      `tarball is missing all files under "${REQUIRED_PREFIX}". ` +
        'Whitelist in package.json#files[] likely dropped the `dist/**/*.js` glob. ' +
        `Total files in pack: ${files.length}.`
    );
  }

  process.stdout.write(
    `verify-codegraph-tarball: OK (${codegraphFiles.length} file(s) under ${REQUIRED_PREFIX})\n`
  );
  process.exit(0);
}

main();
