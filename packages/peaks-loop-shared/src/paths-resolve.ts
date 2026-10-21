import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

/**
 * The package that owns the assets — `skills/`, `schemas/`, `contracts/`.
 * The shared package ships `dist/**` only, so it can never be the answer.
 */
const ROOT_PACKAGE_NAME = 'peaks-loop';

/**
 * The env var that redirects the canonical asset store. The same name
 * `scripts/canonical-store.mjs` uses (`CANONICAL_ROOT_ENV`).
 *
 * It is spelled out here rather than imported because that script lives in
 * the ROOT package and this package publishes `dist/**` only — the two
 * cannot import each other. One name, two readers, and the value is the
 * store's LOCATION, not behaviour.
 */
const CANONICAL_ROOT_ENV = 'PEAKS_HOME';

/** Does this directory look like the root package? `package.json` + `skills/`. */
function isRootPackageDir(dir: string): boolean {
  return existsSync(resolve(dir, 'package.json')) && existsSync(resolve(dir, 'skills'));
}

/**
 * The canonical asset store — the legal home of the skills: `$PEAKS_HOME`,
 * else `~/.peaks`. `null` when there is no home to speak of.
 */
export function canonicalStoreRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env[CANONICAL_ROOT_ENV];
  if (typeof configured === 'string' && configured.trim().length > 0) return resolve(configured);
  const home = homedir();
  if (typeof home !== 'string' || home.length === 0) return null;
  return resolve(home, '.peaks');
}

/**
 * The directory that holds the peaks assets — the root package's directory.
 *
 * The lookup must not depend on how npm laid the install out. The root
 * package ships `skills/`; the shared package ships `dist/**` only, so the
 * walk can never land on the shared package itself. npm NESTS the
 * sub-packages under the root package in a global install and HOISTS them
 * beside it in a local one, and a walk that only looks for "a directory with
 * package.json AND skills/" finds the root in the nested layout and misses it
 * in the hoisted one. That is why the published CLI died on its first import
 * after a local install, while the global one worked.
 *
 * So every level of the walk asks one more question: is the root package
 * BESIDE this directory? The answer no longer depends on npm's choice of
 * layout — the root is found whether it is an ancestor (a checkout, a nested
 * install) or a sibling in the same `node_modules` (a hoisted install, a pnpm
 * store).
 *
 * The canonical store is the last resort — the skills' legal home, and the
 * one place they are guaranteed to be when the root package is not on disk
 * at all (this package installed on its own).
 */
export function findRepoRoot(startPath: string): string {
  let current = resolve(startPath);

  for (;;) {
    if (isRootPackageDir(current)) return current;
    const beside = resolve(current, ROOT_PACKAGE_NAME);
    if (isRootPackageDir(beside)) return beside;

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  const canonical = canonicalStoreRoot();
  if (canonical !== null && existsSync(resolve(canonical, 'skills'))) return canonical;

  throw new Error(`Unable to locate Peaks repository root from ${startPath}`);
}
