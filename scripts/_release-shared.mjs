/**
 * _release-shared.mjs — shared internals for scripts/release-pack.mjs
 * and the regression tests in tests/unit/release/. Keeping the
 * portable pnpm invocation, the Windows-friendly tar path
 * conversion, and the verifyTarball predicate in one file means
 * a future refactor changes ONE place — and prevents the test from
 * mirroring the predicate (which is what got out-of-sync last pass).
 *
 * No top-level side effects — pure functions + minimal lazy lookups.
 * Safe to import in any context.
 *
 * Exports:
 *   - resolvePnpmInvocation(): { bin, prefixArgs } | undefined
 *   - runPnpm(args, opts)
 *   - npmCmdBin(): string
 *   - runNpm(args, opts)
 *   - toPosixPath(p): string
 *   - inspectTarball(tarball): JSON manifest object
 *   - verifyTarball(tarball, name, version, internalPackages): { ok, errors[], manifest }
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Portable pnpm invocation. Strategy (try in order):
 *
 *   1. Windows: derive from `dirname(process.execPath)/node_modules/pnpm/bin/pnpm.mjs`.
 *      Works for nvm4w, nvm-windows, the official Node installer,
 *      and any custom install where pnpm ships next to node.exe.
 *   2. Bare `pnpm` shim — POSIX + GitHub Actions runners (which
 *      put pnpm on PATH via `pnpm/action-setup@v4`).
 *
 * Returns `undefined` when neither path is reachable so the caller
 * surfaces a clean error rather than an ENOENT.
 */
export function resolvePnpmInvocation() {
  if (process.platform === 'win32') {
    const winShim = `${dirname(process.execPath)}\\node_modules\\pnpm\\bin\\pnpm.mjs`;
    if (existsSync(winShim)) return { bin: process.execPath, prefixArgs: [winShim] };
  }
  return undefined;
}

export function runPnpm(args, opts) {
  const inv = resolvePnpmInvocation();
  return inv
    ? execFileSync(inv.bin, [...inv.prefixArgs, ...args], opts)
    : execFileSync('pnpm', args, opts);
}

/** `npm.cmd` shim on Windows (else `npm`).
 *  `shell: true` is required on Windows because `npm.cmd` is
 *  interpreted by cmd.exe. We keep it off on POSIX. */
export function npmCmdBin() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}
export function runNpm(args, opts) {
  return execFileSync(npmCmdBin(), args, { ...opts, shell: process.platform === 'win32' });
}

/**
 * Convert a Windows path (`C:\Users\…`) to the POSIX form GNU tar
 * accepts (`/c/users/…`). tar on Windows misreads backslashes as
 * remote-host specs — see tar manual "REAR". No-op on POSIX.
 */
export function toPosixPath(p) {
  if (process.platform !== 'win32') return p;
  return p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_full, drive) => `/${drive.toLowerCase()}`);
}

/** Read `package/package.json` out of a tarball into an object.
 *  Throws on tar failure. */
export function inspectTarball(tarball) {
  const out = execFileSync('tar', ['-xOf', toPosixPath(tarball), 'package/package.json'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString('utf8');
  return JSON.parse(out);
}

/**
 * Verify a packed tarball is publishable.
 *
 * Returns `{ ok: true, errors: [], manifest }` on success or
 * `{ ok: false, errors: [...], manifest }` on failure. Does NOT
 * throw. The top-level release-pack.mjs wraps this and throws on
 * `!ok`; regression tests assert on the verdict directly.
 *
 * @param {string} tarball absolute path to the .tgz
 * @param {string} name expected manifest.name
 * @param {string} version expected manifest.version
 * @param {{ name: string, version: string }[]} internalPackages
 *   the canonical internal-package set (name + version) used as
 *   the ground-truth pin target. Each must match the pinned dep
 *   inside the packed manifest for the tarball to be publishable.
 */
export function verifyTarball(tarball, name, version, internalPackages) {
  const errors = [];
  let manifest;
  try {
    manifest = inspectTarball(tarball);
  } catch (err) {
    return { ok: false, errors: [`failed to read ${tarball}: ${err?.message ?? String(err)}`], manifest: null };
  }
  if (manifest.name !== name) errors.push(`manifest name = ${manifest.name}, expected ${name}`);
  if (manifest.version !== version) errors.push(`manifest version = ${manifest.version}, expected ${version}`);
  const raw = JSON.stringify(manifest);
  if (raw.includes('workspace:')) {
    errors.push('tarball leaked workspace: protocol; pnpm did not rewrite internal deps');
  }
  const internalIndex = new Map((internalPackages ?? []).map((p) => [p.name, p.version]));
  const deps = { ...(manifest.dependencies ?? {}), ...(manifest.optionalDependencies ?? {}) };
  for (const [depName, depRange] of Object.entries(deps)) {
    const localVersion = internalIndex.get(depName);
    if (localVersion === undefined) continue;
    if (!/^\d+\.\d+\.\d+([-+].+)?$/.test(depRange)) {
      errors.push(`internal dep ${depName} is not pinned to an exact semver: ${depRange}`);
      continue;
    }
    if (localVersion !== depRange) {
      errors.push(`internal dep ${depName}: pinned ${depRange}, local manifest is ${localVersion}`);
    }
  }
  return { ok: errors.length === 0, errors, manifest };
}
