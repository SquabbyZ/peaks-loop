/**
 * Check: codegraph capability (`capability:codegraph`).
 *
 * Verifies that `@colbymchenry/codegraph` resolves at the pinned
 * version AND that the binary exists at the expected on-disk path.
 * Fails when the version drifts, when the binary is missing, or
 * when the package is not resolvable at all.
 *
 * Slice rid-CG-003 (spike follow-up #3): also detects which managed
 * codegraph directory is in use — `.peaks/.codegraph/` (preferred)
 * or root `.codegraph/` (legacy) — via the injected `managedPathProbe`.
 * The CG-007 yarn-pnp fallback is preserved as the package-resolution
 * default; the managed-path probe defaults to the same fs-walk-style
 * helper and is independently injectable for tests.
 *
 * The probe is injected so tests do not depend on the real
 * `node_modules` resolution; the default probe uses
 * `createRequire(import.meta.url)` to find the package.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { createRequire } from 'node:module';

import { getErrorMessage } from 'peaks-loop-shared/result';
import { resolveCodegraphProjectRoot } from '../../../codegraph/codegraph-service.js';

import type { CodegraphCapabilityProbe, CodegraphManagedPathInfo, DoctorCheck, DoctorCheckPlugin, DoctorContext } from '../types.js';

const CODEGRAPH_EXPECTED_VERSION = '0.7.10';
const CODEGRAPH_PACKAGE_NAME = '@colbymchenry/codegraph';

function findCodegraphPackageJsonFallback(startDir: string): string | null {
  // Slice rid-CG-007 (downstream safety): yarn-pnp / pnpm-strict /
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
  let binaryPath: string;
  try {
    binaryPath = resolvePath(dirname(packagePath), 'dist', 'bin', 'codegraph.js');
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
    // Slice rid-CG-003 — resolve the managed codegraph directory
    // relative to the cwd the doctor itself was invoked from.
    // Best-effort: when the operator ran `peaks doctor` outside a
    // project (cwd has neither `.peaks/.codegraph/` nor
    // `.codegraph/`) we still report `fresh-preferred` so the check
    // message names the canonical future location.
    managedPath: detectManagedCodegraphPath(process.cwd())
  };
  return result;
}

/**
 * Slice rid-CG-003 — pure wrapper over `resolveCodegraphProjectRoot`
 * that returns a probe-shaped managed-path payload (or null when
 * the cwd does not look like a peaks project root).
 */
function detectManagedCodegraphPath(cwd: string): CodegraphManagedPathInfo | null {
  try {
    const location = resolveCodegraphProjectRoot(cwd);
    return {
      source: location.source,
      codegraphDir: location.codegraphDir,
      cwd: location.cwd
    };
  } catch {
    return null;
  }
}

function renderManagedPathSuffix(managedPath: CodegraphManagedPathInfo | null): string {
  if (!managedPath) {
    return '';
  }
  if (managedPath.source === 'preferred') {
    return `; managed path: ${managedPath.codegraphDir} (preferred .peaks/.codegraph/)`;
  }
  if (managedPath.source === 'legacy') {
    return `; managed path: ${managedPath.codegraphDir} (legacy root .codegraph/ — consider moving to .peaks/.codegraph/)`;
  }
  return `; managed path: ${managedPath.codegraphDir} (fresh-preferred — no codegraph dir yet; next init will create it)`;
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
      // rid-CG-007: downstream consumers may pull a different
      // version via yarn-pnp / pnpm-strict. Surface as a warning
      // (ok: false, severity: warning) so the check does NOT flip
      // the doctor exit code. Upstream 0.7.x binaries are wire-
      // compatible with 0.7.10 for the subset peaks-loop exercises
      // (status / init / index / query / files / context / affected).
      return [{
        id: 'capability:codegraph',
        ok: false,
        severity: 'warning',
        message: `@colbymchenry/codegraph version drift: expected ${CODEGRAPH_EXPECTED_VERSION}, resolved ${result.version} at ${result.packagePath} — peaks-loop uses an allow-list of subcommands and tolerates 0.7.x wire-compat. Run \`pnpm install @colbymchenry/codegraph@${CODEGRAPH_EXPECTED_VERSION}\` to pin.${managedPathSuffix}`
      }];
    }
    if (!result.binaryExists) {
      return [{
        id: 'capability:codegraph',
        ok: false,
        message: `@colbymchenry/codegraph@${result.version} resolved at ${result.packagePath} but binary is missing at ${result.binaryPath}${managedPathSuffix}`
      }];
    }
    return [{
      id: 'capability:codegraph',
      ok: true,
      message: `@colbymchenry/codegraph@${result.version} resolves with binary at ${result.binaryPath}${managedPathSuffix}`
    }];
  } catch (error) {
    return [{
      id: 'capability:codegraph',
      ok: false,
      message: `@colbymchenry/codegraph not resolvable: ${getErrorMessage(error)}`
    }];
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

export const check: DoctorCheckPlugin = {
  name: 'codegraph-capability',
  run
};