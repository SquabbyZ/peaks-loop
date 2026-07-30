#!/usr/bin/env node
// Slice 2026-07-30 — build-integrity self-check.
//
// Root cause being closed: a tsc incremental-cache miss can
// leave packages/*/dist out of sync with packages/*/src. The
// most recent live incident was peaks-loop-shared/dist/
// missing version.js entirely after a build, which cascaded
// into a global peaks CLI that throws ERR_MODULE_NOT_FOUND
// the moment any subcommand touches doctor-service.
//
// This script walks every package under packages/*, counts
// its src/*.ts entry points, and verifies dist contains the
// expected triple per source (.js + .d.ts + .js.map). Any
// mismatch throws with the package name + the specific file
// it's missing or carrying extra of.
//
// Why not rely on tsc --noEmit? Because the bug is not a
// type error — it's a successful (silent) skip of a file
// whose mtime did not change between runs.
//
// Why exit 1 instead of returning an object? Because this
// script is wired into pnpm run build (last step), CI
// publish.yml, and prepublishOnly — all of which treat a
// non-zero exit as a hard stop. Returning a structured
// object would force every caller to duplicate the
// success/failure logic.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const packagesRoot = join(repoRoot, 'packages');

// `index.ts` is the root entry — we always expect it.
// `version.ts` (in peaks-loop-shared) is a special-case that
// sync-version.mjs emits just-in-time, so it is also always
// expected when the package has a `version` entry in its
// package.json#exports. We detect that via the exports map.
const expectedExports = new Map();

function loadExpectedExports(pkgName) {
  const pkgJsonPath = join(packagesRoot, pkgName, 'package.json');
  if (!existsSync(pkgJsonPath)) return [];
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  const exportsField = pkg.exports;
  if (!exportsField || typeof exportsField !== 'object') return [];
  // Each exports key (other than ".") is a sub-export whose
  // source file lives at src/<sub-path>.ts. For "." the
  // source is src/index.ts.
  const expected = [];
  for (const [subpath, target] of Object.entries(exportsField)) {
    if (subpath === '.') {
      expected.push('index.ts');
      continue;
    }
    const trimmed = subpath.replace(/^\.\//, '');
    if (!trimmed) continue;
    expected.push(`${trimmed}.ts`);
  }
  return expected;
}

function listTsSources(pkgName) {
  const srcDir = join(packagesRoot, pkgName, 'src');
  if (!existsSync(srcDir)) return [];
  return readdirSync(srcDir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .sort();
}

function listDistJs(pkgName) {
  const distDir = join(packagesRoot, pkgName, 'dist');
  if (!existsSync(distDir)) return [];
  return readdirSync(distDir)
    .filter((f) => f.endsWith('.js'))
    .sort();
}

const errors = [];

for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const pkgName = entry.name;
  const sources = listTsSources(pkgName);
  if (sources.length === 0) continue; // Skip packages without src/.

  const expected = new Set([
    ...sources,
    ...loadExpectedExports(pkgName).filter((f) =>
      // Only count exports that map to a real .ts in src/.
      sources.includes(f),
    ),
  ]);

  // Phantom-export detection: a package.json#exports entry
  // whose sub-path does NOT resolve to a src/*.ts is a drift
  // hazard — a downstream `import('pkg/<sub>')` would resolve
  // to a missing file at runtime, the same shape as the
  // 2026-07-30 peaks-loop-shared/version.js miss that crashed
  // the global `peaks` CLI. Flag it explicitly so the
  // publish gate catches the drift instead of letting it
  // ship.
  for (const exportFile of loadExpectedExports(pkgName)) {
    if (!sources.includes(exportFile)) {
      errors.push(
        `${pkgName}: package.json exports references src/${exportFile} but the source file is absent (phantom export)`,
      );
    }
  }

  const distJs = new Set(listDistJs(pkgName));

  // 1. Every src/*.ts must have a matching dist/*.js.
  for (const ts of expected) {
    const expectedJs = ts.replace(/\.ts$/, '.js');
    if (!distJs.has(expectedJs)) {
      errors.push(`${pkgName}: missing dist/${expectedJs} (source: src/${ts})`);
    }
  }

  // 2. Every dist/*.js must correspond to a src/*.ts.
  for (const js of distJs) {
    const expectedTs = js.replace(/\.js$/, '.ts');
    if (!expected.has(expectedTs)) {
      errors.push(`${pkgName}: orphan dist/${js} (no matching src/${expectedTs})`);
    }
  }

  // 3. dist must include .d.ts for every .js (declaration:
  // true is set unconditionally in tsconfig.base.json).
  // .js.map is OPTIONAL — tsc emits it only when the
  // tsconfig has `sourceMap: true`. As of 2026-07-30 the
  // base tsconfig has sourceMap: false, so .js.map is
  // expected to be absent. We tolerate either state.
  const distDir = join(packagesRoot, pkgName, 'dist');
  for (const js of distJs) {
    const base = js.replace(/\.js$/, '');
    const dtsPath = join(distDir, `${base}.d.ts`);
    if (!existsSync(dtsPath)) {
      errors.push(`${pkgName}: missing dist/${base}.d.ts (sibling of dist/${js})`);
    }
  }
}

if (errors.length > 0) {
  process.stderr.write(
    'build-integrity check failed:\n  ' + errors.join('\n  ') + '\n',
  );
  process.exit(1);
}

// Quiet success path — pipeline callers don't want a
// chatty stdout that mixes with build output. Operators
// running the script standalone can grep for this line.
process.stdout.write('build-integrity: OK\n');
