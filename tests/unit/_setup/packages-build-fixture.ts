// tests/unit/_setup/packages-build-fixture.ts
//
// The fixture scaffolding of `tests/unit/scripts/packages-build-prerequisite.
// test.ts`, split out when the cases added by rid-muf2sasw repair 5 took that
// file past its `max-lines` ceiling (400 code lines, `skipComments`). Nothing
// here is new: the four exported helpers and the tmp-root cleanup are the
// versions that file already carried.
//
// Why `_setup/`: it is this repo's home for shared test scaffolding
// (`4dim-template.ts`, `tmp-workspace.ts`, `io.ts`, `clock.ts`), and a helper
// here registers its hooks at COLLECTION time, which is where the cleanup below
// has to bind — the same rule `io.ts` records for `withEnv`.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach } from 'vitest';

import { listPackageRoots, lockPath } from '../../../scripts/packages-build-prerequisite.mjs';

/** The repository root, from this file's location: `tests/unit/_setup/` → repo. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Same length on purpose: the "content changed, mtime restored" case. */
export const SOURCE_A = 'export const a = 1;\n';
export const SOURCE_B = 'export const a = 2;\n';

/** The bytes of a built artifact — `writeBuilt`'s content, exported for reuse. */
export const BUILT = 'export const built = true;\n';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) {
    // The lock lives in os.tmpdir(), not under the fixture, so it outlives the
    // rmSync below — a case that holds one on purpose must not leak it.
    // `recursive` because the "cannot be created" case makes it a directory.
    rmSync(lockPath(root), { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
  roots.length = 0;
});

/**
 * A throwaway tree with `packages/<name>/src/index.ts` and NO `dist/` — the
 * state of a clean checkout as far as this prerequisite is concerned. An empty
 * `sources` gives a tree whose `packages/` holds nothing to build.
 */
export function fixture(sources: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-packages-build-'));
  roots.push(root);
  mkdirSync(join(root, 'packages'), { recursive: true });
  for (const [name, source] of Object.entries(sources)) {
    const src = join(root, 'packages', name, 'src');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'index.ts'), source, 'utf8');
  }
  return root;
}

/** A built artifact, so the package reads as "built" rather than missing. */
export function writeBuilt(root: string, name: string): string {
  const dist = join(root, 'packages', name, 'dist');
  mkdirSync(dist, { recursive: true });
  const file = join(dist, 'index.js');
  writeFileSync(file, BUILT, 'utf8');
  return file;
}

/**
 * A stand-in for `pnpm -r --filter "./packages/*" run build`. It records the
 * call — which is the independently-sourced evidence that a build happened —
 * and materialises the artifacts a real build would.
 */
export function recordingBuild(calls: string[]): (root: string) => void {
  return (root: string): void => {
    calls.push(root);
    for (const pkg of listPackageRoots(root)) writeBuilt(root, pkg.name);
  };
}

export function collectLog(): { lines: string[]; log: (line: string) => void } {
  const lines: string[] = [];
  return { lines, log: (line) => lines.push(line) };
}

/**
 * Independent source 1 — git's index. It enumerates from tracked paths, not
 * from a `readdirSync` recursion, and it sees a new package at the same moment
 * the walk does.
 */
export function packageNamesFromGit(): string[] {
  const listed = execFileSync('git', ['ls-files', '-z', '--', 'packages'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    // Repo standard (`tests/unit/spawn-windows-hide-guard.test.ts`).
    windowsHide: true
  });
  const names = new Set<string>();
  for (const path of listed.split('\u0000')) {
    const segments = path.split('/');
    if (segments.length === 3 && segments[2] === 'package.json') {
      names.add(segments[1] ?? '');
    }
  }
  return [...names].sort();
}

/**
 * Independent source 2 — the resolution path the tests themselves take. Every
 * workspace package is a root dependency, so `node_modules` links exactly the
 * packages that a `tests/**` import can resolve to. This is the set that makes
 * the prerequisite necessary at all.
 */
export function packageNamesFromNodeModules(): string[] {
  return readdirSync(join(REPO_ROOT, 'node_modules'))
    .filter((name) => name.startsWith('peaks-loop-'))
    .sort();
}
