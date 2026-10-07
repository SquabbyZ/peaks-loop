// src/services/codegraph/codegraph-upstream-layout.ts
//
// ONE answer to "where did the installed `@colbymchenry/codegraph` put its
// files", for the four places peaks-loop reaches into the package.
//
// WHY THIS EXISTS (the 1.6.2 upgrade). Before it, one rule covered all four
// sites: join `dist/…` onto whatever directory upstream's `package.json`
// sits in. That rule is false from 1.6.x. The main package there is TYPE
// DEFINITIONS ONLY — `find dist -name '*.js' | wc -l` is 0 — and the runtime
// moved into a per-platform optionalDependency
// (`@colbymchenry/codegraph-<platform>-<arch>`), whose own `lib/dist/` holds
// the entry AND the modules. Every one of the four joins therefore resolved
// to a path that does not exist, so the binary could not be spawned and the
// two oracles could not be loaded.
//
// The fix is a PROBE, not a version check: the candidates are ordered
// newest-layout-first (per-platform bundle, then the main package's own
// `dist/`) and the first one whose `dist/bin/codegraph.js` actually exists
// wins. So a 0.7.x install still resolves, a future release that moves the
// files again is found without an edit here, and nothing is decided by a
// version string that can drift from the filesystem.
//
// This module is separate from `codegraph-service.ts` rather than a few more
// functions inside it, because that file sits under eslint's `max-lines` cap
// and the resolver does not fit. It has no dependency on the service, so the
// two oracles can import it without pulling in the service's session and
// process-runner imports.

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const CODEGRAPH_PACKAGE_NAME = '@colbymchenry/codegraph';
/** The directory a 1.6.x per-platform bundle keeps its `dist/` under. */
const CODEGRAPH_BUNDLE_LIB_DIR = 'lib';

export type CodegraphUpstreamLayout = {
  /**
   * Absolute path of the script to spawn with `process.execPath`. Empty
   * string when NO candidate directory holds an entry at all — the caller
   * then fails with a path it can name rather than with a silent `undefined`.
   */
  readonly binaryPath: string;
  /**
   * Absolute path of the directory holding upstream's JS modules
   * (`types.js`, `extraction/grammars.js`). Same `dist/` the entry's `bin/`
   * lives under, so one probe locates both.
   */
  readonly moduleDir: string;
};

/**
 * Directories a `dist/` might hang off, newest layout first.
 *
 * The platform bundle is resolved through a require anchored AT the main
 * package's own `package.json`, never at this module: the bundle is a
 * dependency OF the main package, so under pnpm's isolated layout it is
 * linked into the MAIN package's `node_modules/` and is invisible to a
 * require anchored here. A missing bundle (0.7.x, or a registry mirror that
 * skipped the optionalDependency) is not an error — the main package's own
 * `dist/` is the next candidate.
 */
function upstreamDistRoots(packageJsonPath: string): string[] {
  const bundlePackageName = `${CODEGRAPH_PACKAGE_NAME}-${process.platform}-${process.arch}`;
  let bundleDir: string | null = null;

  try {
    const require = createRequire(packageJsonPath);
    const bundlePackageJson = require.resolve(`${bundlePackageName}/package.json`);

    bundleDir = dirname(bundlePackageJson);
  } catch {
    // A missing bundle is an EXPECTED state, not a swallow: 0.7.x has none,
    // and a registry mirror that did not mirror the optionalDependency
    // leaves the install without one. It is reported by the assignment —
    // the caller below then has exactly one candidate root instead of two.
    bundleDir = null;
  }

  const roots = bundleDir === null ? [] : [join(bundleDir, CODEGRAPH_BUNDLE_LIB_DIR)];

  roots.push(dirname(packageJsonPath));

  return roots;
}

/**
 * Resolve upstream's layout for one `package.json` path.
 *
 * `packageJsonPath` is a parameter rather than a lookup because the doctor's
 * yarn-pnp fallback reaches the same package by a filesystem walk and needs
 * the layout for THAT path, not for whatever `createRequire` finds.
 */
export function codegraphUpstreamLayoutFor(packageJsonPath: string): CodegraphUpstreamLayout {
  const distDirs = upstreamDistRoots(packageJsonPath).map((root) => join(root, 'dist'));
  const probed = distDirs.find((dir) => existsSync(join(dir, 'bin', 'codegraph.js')));
  const moduleDir = probed ?? distDirs[0] ?? '';

  return {
    binaryPath: moduleDir === '' ? '' : join(moduleDir, 'bin', 'codegraph.js'),
    moduleDir
  };
}

/** `codegraphUpstreamLayoutFor` for whichever install this process runs against. */
export function resolveCodegraphUpstreamLayout(): CodegraphUpstreamLayout {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve(`${CODEGRAPH_PACKAGE_NAME}/package.json`);

  return codegraphUpstreamLayoutFor(packageJsonPath);
}
