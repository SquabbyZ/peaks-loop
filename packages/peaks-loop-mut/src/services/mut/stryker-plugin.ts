/**
 * Resolution of the vitest-runner plugin for the production Stryker invoker.
 *
 * MEASURED against @stryker-mutator/core 9.6.1 and
 * @stryker-mutator/vitest-runner 9.6.1:
 *
 *   `PluginLoader.resolvePluginModules()` accepts an absolute path and turns
 *   it into a `file://` URL, and the child worker re-imports that same
 *   descriptor. So the vitest runner is loaded from THIS package's own
 *   installation, never from the target project. Measured: a fixture with NO
 *   node_modules still ran it.
 *
 * WHY THE ABSOLUTE PATH AND NOT THE BARE SPECIFIER. The bare specifier would
 * only work when the runner happens to sit next to `@stryker-mutator/core` in
 * the same `node_modules`. Measured in this repository's pnpm layout, the
 * glob Stryker uses for its default plugin list resolves to core's pnpm
 * sibling directory, which contains only api, core, instrumenter and util —
 * all four are in Stryker's `IGNORED_PACKAGES` list, so the default glob
 * finds NO vitest runner.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

import { MUT_ERROR_CODES, MutToolchainError } from './stryker-errors.js';

/**
 * Resolve the vitest runner plugin from THIS package's own installation
 * so the target project does not need a node_modules of its own.
 */
export function resolveVitestRunnerPlugin(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve('@stryker-mutator/vitest-runner/package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { exports?: Record<string, unknown> };
    return resolve(dirname(pkgPath), resolvePackageEntry(pkg.exports?.['.']));
  } catch (err: unknown) {
    throw new MutToolchainError(
      MUT_ERROR_CODES.toolchainUnavailable,
      'The mutation toolchain is not available: @stryker-mutator/vitest-runner could not be resolved ' +
        `from the peaks-loop-mut installation. ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
  }
}

/** Read a package `exports` entry that may be a string or a nested object. */
function resolvePackageEntry(entry: unknown): string {
  if (typeof entry === 'string') {
    return entry;
  }
  if (entry && typeof entry === 'object') {
    const record = entry as Record<string, unknown>;
    for (const candidate of [record['default'], record['import']]) {
      if (typeof candidate === 'string') {
        return candidate;
      }
      if (candidate && typeof candidate === 'object') {
        const nested = (candidate as Record<string, unknown>)['default'];
        if (typeof nested === 'string') {
          return nested;
        }
      }
    }
  }
  throw new Error('the package does not declare a resolvable "exports" entry');
}
