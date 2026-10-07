/**
 * Check: codegraph capability (`capability:codegraph`).
 *
 * Verifies that `@colbymchenry/codegraph` resolves at the pinned
 * version AND that the binary exists at the expected on-disk path.
 * Fails when the version drifts, when the binary is missing, or
 * when the package is not resolvable at all.
 *
 * The check also reports the managed codegraph data directory in use —
 * always the root `.codegraph/` — via the injected `managedPathProbe`.
 * The CG-007 yarn-pnp fallback is preserved as the package-resolution
 * default; the managed-path probe defaults to the same root-only
 * resolver and is independently injectable for tests.
 *
 * The probe is injected so tests do not depend on the real
 * `node_modules` resolution; the default probe uses
 * `createRequire(import.meta.url)` to find the package.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

import { getErrorMessage } from 'peaks-loop-shared/result';
import { resolveCodegraphProjectRoot } from '../../../codegraph/codegraph-service.js';
import { codegraphUpstreamLayoutFor } from '../../../codegraph/codegraph-upstream-layout.js';

import type {
  CodegraphCapabilityProbe,
  CodegraphManagedPathInfo,
  DoctorCheck,
  DoctorCheckPlugin,
  DoctorContext
} from '../types.js';

const CODEGRAPH_EXPECTED_VERSION = '1.6.2';
const CODEGRAPH_PACKAGE_NAME = '@colbymchenry/codegraph';

function findCodegraphPackageJsonFallback(startDir: string): string | null {
  // sub-package consumers may not expose `@colbymchenry/codegraph` to
  // `createRequire(import.meta.url).resolve`. The fallback walks up
  // the directory tree from `startDir` looking for
  // `node_modules/@colbymchenry/codegraph/package.json`.
  //
  // Pinned at <=8 levels so the walk is bounded and the check never
  // becomes O(repo-size) on a misconfigured consumer.
  const MAX_DEPTH = 8;
  let current: string | null = startDir;
  for (let depth = 0; depth < MAX_DEPTH && current !== null; depth += 1) {
    const candidate = join(current, 'node_modules', CODEGRAPH_PACKAGE_NAME, 'package.json');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

function defaultCodegraphProbe(): CodegraphCapabilityProbe {
  const require = createRequire(import.meta.url);
  let packagePath: string;
  try {
    packagePath = require.resolve(`${CODEGRAPH_PACKAGE_NAME}/package.json`);
  } catch (primaryError) {
    // Fall back to an fs walk from the cwd. This covers
    // yarn-pnp, pnpm-strict, and sub-package consumers whose
    // require-resolve graph does not surface the package through
    // `createRequire(import.meta.url)` even when the package is
    // physically installed.
    const fallback = findCodegraphPackageJsonFallback(process.cwd());
    if (fallback === null) {
      // Re-throw the original require.resolve error so the caller
      // sees the canonical failure message — the fallback path is
      // best-effort, not a replacement.
      throw primaryError;
    }
    packagePath = fallback;
  }
  let version = 'unknown';
  try {
    const pkgRaw = readFileSync(packagePath, 'utf8');
    const parsed = JSON.parse(pkgRaw) as { version?: string };
    version = parsed.version ?? 'unknown';
  } catch {
    // Fall through with version='unknown'; the binary-existence
    // check below is the load-bearing assertion.
  }
  // Probing, not path-joining: 1.6.x keeps the entry in the per-platform
  // bundle's `lib/dist/`, not in the main package's own `dist/`. The shared
  // resolver is the same one the spawn path uses, so the doctor cannot
  // report "binary exists" at a path the spawn would not use.
  let binaryPath: string;
  try {
    binaryPath = codegraphUpstreamLayoutFor(packagePath).binaryPath;
  } catch {
    binaryPath = '';
  }
  let binaryExists = false;
  if (binaryPath.length > 0) {
    try {
      binaryExists = statSync(binaryPath).isFile();
    } catch {
      binaryExists = false;
    }
  }
  const result: CodegraphCapabilityProbe = {
    packagePath,
    version,
    binaryPath,
    binaryExists,
    // Resolve the managed codegraph directory relative to the cwd the
    // doctor itself was invoked from. Root-only: always names
    // `<cwd>/.codegraph/`.
    managedPath: detectManagedCodegraphPath(process.cwd())
  };
  return result;
}

/**
 * Pure wrapper over `resolveCodegraphProjectRoot` that returns a
 * probe-shaped managed-path payload for the root `.codegraph/`.
 */
function detectManagedCodegraphPath(cwd: string): CodegraphManagedPathInfo {
  const location = resolveCodegraphProjectRoot(cwd);
  return {
    source: location.source,
    codegraphDir: location.codegraphDir,
    cwd: location.cwd
  };
}

function renderManagedPathSuffix(managedPath: CodegraphManagedPathInfo | null): string {
  if (!managedPath) {
    return '';
  }
  return `; managed path: ${managedPath.codegraphDir}`;
}

function runCheck(
  probe: () => CodegraphCapabilityProbe,
  managedPathProbe: () => CodegraphManagedPathInfo | null
): readonly DoctorCheck[] {
  try {
    const result = probe();
    const managedPath = managedPathProbe();
    const versionOk = result.version === CODEGRAPH_EXPECTED_VERSION;
    const managedPathSuffix = renderManagedPathSuffix(managedPath);
    if (!versionOk) {
      // version via yarn-pnp / pnpm-strict. Still a warning rather than an
      // error — the pinned subcommand surface is stable, and a drift is not
      // by itself a broken install — but the tolerance is NOT the wire
      // compatibility the old `0.7.x` band had, where patch drift really was
      // wire-compatible with the pin. 1.6.x is a rewrite of the runtime and
      // of the index's on-disk schema: opening a 0.7.10-built `.codegraph/`
      // with it migrates the database, and the migration is not reversible.
      // So the message states the drift and the pin command and names the
      // axis that actually moves, instead of reassuring the reader about a
      // compatibility that does not hold across 0.7.x → 1.6.x.
      return [
        {
          id: 'capability:codegraph',
          ok: false,
          severity: 'warning',
          message: `@colbymchenry/codegraph version drift: expected ${CODEGRAPH_EXPECTED_VERSION}, resolved ${result.version} at ${result.packagePath} — peaks-loop uses an allow-list of subcommands, but the index schema is NOT stable across a major version (0.7.x and 1.6.x cannot share one .codegraph/ directory). Run \`pnpm install @colbymchenry/codegraph@${CODEGRAPH_EXPECTED_VERSION}\` to pin.${managedPathSuffix}`
        }
      ];
    }
    if (!result.binaryExists) {
      return [
        {
          id: 'capability:codegraph',
          ok: false,
          message: `@colbymchenry/codegraph@${result.version} resolved at ${result.packagePath} but binary is missing at ${result.binaryPath}${managedPathSuffix}`
        }
      ];
    }
    return [
      {
        id: 'capability:codegraph',
        ok: true,
        message: `@colbymchenry/codegraph@${result.version} resolves with binary at ${result.binaryPath}${managedPathSuffix}`
      }
    ];
  } catch (error) {
    return [
      {
        id: 'capability:codegraph',
        ok: false,
        message: `@colbymchenry/codegraph not resolvable: ${getErrorMessage(error)}`
      }
    ];
  }
}

function run({ options }: DoctorContext): readonly DoctorCheck[] {
  const probe = options.codegraphProbe ?? defaultCodegraphProbe;
  const managedPathProbe = options.codegraphManagedPathProbe ?? defaultCodegraphManagedPathProbe;
  return runCheck(probe, managedPathProbe);
}

function defaultCodegraphManagedPathProbe(): CodegraphManagedPathInfo | null {
  return detectManagedCodegraphPath(process.cwd());
}

// `: DoctorCheckPlugin` annotation. The annotation widened this object
// literal to the interface's `run` return type
// (`readonly DoctorCheck[] | Promise<readonly DoctorCheck[]>`) — an
// honest union, because three plugins in this directory really are
// `async`. The widening leaked into every importer and produced 40
// TS7053 errors at test call sites, where the runtime value is
// measurably a plain array (this module's `run` is synchronous).
// `satisfies` keeps the interface check AND the concrete narrow type,
// so the compile error re-fires if `run` ever becomes async.
export const check = {
  name: 'codegraph-capability',
  run
} satisfies DoctorCheckPlugin;
