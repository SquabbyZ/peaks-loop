/**
 * Bug-04 regression (ice-cola surface check 2026-07-22): the previous
 * `scripts/sync-version.mjs` rewrote `packages/peaks-loop-shared/src/
 * version.ts` but DID NOT invalidate the existing `dist/version.js` /
 * `dist/version.d.ts` / `dist/version.d.ts.map` produced by a prior
 * `pnpm -F peaks-loop-shared run build`. tsc's incremental cache sees
 * the freshly-written version.ts as the same SIZE as before and skips
 * the recompile, so `release-pack.mjs`'s subsequent `pnpm pack`
 * packages a STALE CLI_VERSION into the npm tarball. Downstream
 * `peaks -v` then reads the old version even though the package's
 * metadata is the new one.
 *
 * Fix: `sync-version.mjs` now unlinks `dist/version.{js,d.ts,d.ts.map}`
 * after writing the new version.ts. tsc then sees no emit target and
 * regenerates the dist file with the fresh CLI_VERSION.
 *
 * This unit test pins the contract: after running sync-version.mjs,
 * the shared `dist/version.js` (a) does not exist OR (b) carries the
 * exact CLI_VERSION written by sync-version.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..');

// Write the contents + force-sync to disk (Windows file-handle race).
function writeSync(path: string, content: string): void {
  const fh = openSync(path, 'w');
  try {
    writeFileSync(fh, content, 'utf8');
  } finally {
    closeSync(fh);
  }
}

function makeFakeRepo(): string {
  // Create a self-contained fake monorepo that mimics the publish.yml
  // layout (root package.json + packages/peaks-loop-shared/{package.json,
  // src/version.ts, dist/version.js}). The test runs
  // `node scripts/sync-version.mjs` against this repo so we never have
  // to touch the real .peaks/ or the real packages/ tree.
  // Use a long path (no 8.3 short-name) to avoid Windows file-handle
  // races between mkdtempSync / openSync.
  const root = join(tmpdir(), `peaks-sync-version-${Date.now()}-${process.pid}`);
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, 'packages', 'peaks-loop-shared', 'dist'), { recursive: true });
  mkdirSync(join(root, 'packages', 'peaks-loop-shared', 'src'), { recursive: true });
  writeSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'peaks-loop', version: '9.9.9-newtag' }, null, 2) + '\n',
  );
  writeSync(
    join(root, 'packages', 'peaks-loop-shared', 'package.json'),
    JSON.stringify({ name: 'peaks-loop-shared', version: '9.9.9-oldsub' }, null, 2) + '\n',
  );
  writeSync(
    join(root, 'packages', 'peaks-loop-shared', 'src', 'version.ts'),
    `export const CLI_VERSION = "stale-shared";\n`,
  );
  // Stage a stale dist/version.js that tsc would normally NOT regenerate.
  writeSync(
    join(root, 'packages', 'peaks-loop-shared', 'dist', 'version.js'),
    `export const CLI_VERSION = "stale-from-old-build";\n`,
  );
  writeSync(
    join(root, 'packages', 'peaks-loop-shared', 'dist', 'version.d.ts'),
    `export declare const CLI_VERSION: string;\n`,
  );
  writeSync(
    join(root, 'packages', 'peaks-loop-shared', 'dist', 'version.d.ts.map'),
    `{"version":3,"file":"version.d.ts","sourceRoot":"","sources":[],"names":[]}\n`,
  );
  // Stage the real scripts/sync-version.mjs into the fake repo's
  // scripts/ so we don't have to mutate the source tree.
  const realScript = readFileSync(join(repoRoot, 'scripts', 'sync-version.mjs'), 'utf8');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeSync(join(root, 'scripts', 'sync-version.mjs'), realScript);
  return root;
}

describe('sync-version.mjs invalidates peaks-loop-shared/dist/version.* (Bug-04 fix)', () => {
  let root: string;
  beforeEach(() => {
    root = makeFakeRepo();
  });
  afterEach(() => {
    if (root && existsSync(root)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('invalidates dist/version.{js,d.ts,d.ts.map} so tsc must regenerate', () => {
    const scriptPath = join(root, 'scripts', 'sync-version.mjs');
    const distJs = join(root, 'packages', 'peaks-loop-shared', 'dist', 'version.js');
    const distDts = join(root, 'packages', 'peaks-loop-shared', 'dist', 'version.d.ts');
    const distMap = join(root, 'packages', 'peaks-loop-shared', 'dist', 'version.d.ts.map');

    expect(existsSync(distJs), 'pre: dist/version.js present (the stale state we want to fix)').toBe(true);
    expect(existsSync(distDts), 'pre: dist/version.d.ts present').toBe(true);
    expect(existsSync(distMap), 'pre: dist/version.d.ts.map present').toBe(true);

    execFileSync(process.execPath, [scriptPath], { cwd: root, stdio: 'pipe' });

    // After sync-version: all 3 dist files MUST be gone, so a subsequent
    // `pnpm -F peaks-loop-shared run build` has to tsc-emit them from the
    // freshly-written `src/version.ts` (whose CLI_VERSION matches root).
    expect(existsSync(distJs), 'post: dist/version.js must be unlinked').toBe(false);
    expect(existsSync(distDts), 'post: dist/version.d.ts must be unlinked').toBe(false);
    expect(existsSync(distMap), 'post: dist/version.d.ts.map must be unlinked').toBe(false);

    // The src/version.ts MUST now carry the root version.
    const written = readFileSync(
      join(root, 'packages', 'peaks-loop-shared', 'src', 'version.ts'),
      'utf8'
    );
    expect(written, 'src/version.ts carries the exact root version').toContain('"9.9.9-newtag"');
  });

  test('idempotent on a missing dist (fresh checkout case)', () => {
    const scriptPath = join(root, 'scripts', 'sync-version.mjs');
    const distDir = join(root, 'packages', 'peaks-loop-shared', 'dist');
    rmSync(distDir, { recursive: true, force: true });
    expect(existsSync(distDir), 'pre: dist gone').toBe(false);

    expect(() =>
      execFileSync(process.execPath, [scriptPath], { cwd: root, stdio: 'pipe' })
    ).not.toThrow();

    // src/version.ts is still written.
    const written = readFileSync(
      join(root, 'packages', 'peaks-loop-shared', 'src', 'version.ts'),
      'utf8'
    );
    expect(written).toContain('"9.9.9-newtag"');
  });
});
