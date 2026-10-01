/**
 * release-pack-registry.mjs — registry probes for the publish decision
 * (split from release-pack.mjs).
 *
 * `release-pack.mjs` exceeded the 300-raw-line file-size cap, so the
 * registry cluster (isAlreadyPublished / isRegistryStale) moved here
 * verbatim. `release-pack.mjs` imports and re-exports `isRegistryStale`
 * so its public surface is unchanged.
 *
 * Cycle note: `isRegistryStale` calls `readVersionJsFromTarballSilent`,
 * which STAYS in `release-pack.mjs` because its (unused) `label`
 * parameter carries an eslint finding that cannot move into a file that
 * must be clean outright. So `release-pack.mjs` ↔ this file import each
 * other. Safe under `module: NodeNext` + `"type": "module"` — every
 * cross-boundary reference is a hoisted function declaration resolved at
 * call time, and neither module reads a value from the other at
 * evaluation time. `projectRoot` is recomputed from THIS module's own
 * import.meta.url (identical value to the parent, same directory).
 */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

import { resolveNpmInvocation } from './_release-shared.mjs';
import { readVersionJsFromTarballSilent } from './release-pack.mjs';

const projectRoot = resolve(fileURLToPath(import.meta.url), '..', '..');

export function isAlreadyPublished(name, version) {
  // Probe npmjs for an existing version of `name`. The CI runner
  // is a fresh container; the `npm view` call goes over OIDC-
  // compatible public registry egress and does NOT require any
  // write access. We return true when the version is already on
  // the registry so the publish step can be skipped; otherwise
  // the npm CLI rejects `npm publish <same version>` with the
  // "cannot publish over the previously published versions" error.
  // 2026-09-10: shell-free npm (see `resolveNpmInvocation` in _release-shared).
  const { bin, prefixArgs } = resolveNpmInvocation();
  const probe = spawnSync(bin, [...prefixArgs, 'view', `${name}@${version}`, 'version', '--json'], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  if (probe.status !== 0) return false;
  const stdout = probe.stdout?.toString?.() ?? '';
  return /"\d+\.\d+\.\d+/.test(stdout) || /\d+\.\d+\.\d+/.test(stdout);
}

// 2026-07-23 follow-up (peaks-publish-stale fix, AC5): when the
// LOCAL tarball is missing `package/dist/version.js`, fail-loud
// instead of returning null/false. The prior `null && regVer` short
// circuit caused the silent SKIP that let stale CLI_VERSION tarballs
// onto npm — peaks-loop@<new> shipping peaks-loop-shared@<new> with
// NO version.js file at all. We refuse to publish such a tarball;
// the upstream publish.yml `gate-cli-version` step is the parallel
// gate for the on-disk state, this is the tarball-level gate.
export function isRegistryStale(name, version, localTarball) {
  const tmp = mkdtempSync(join(os.tmpdir(), 'peaks-stale-'));
  try {
    // Local tarball may not ship `dist/version.js` (e.g.
    // peaks-loop-shared-channel has no CLI_VERSION export). The
    // staleness check only applies to packages that carry a
    // version.js file. Use the silent helper that returns null on
    // missing file instead of throwing.
    const localVer = readVersionJsFromTarballSilent(localTarball, `local ${name}@${version}`);
    if (localVer === null) return false;
    const { bin, prefixArgs } = resolveNpmInvocation();
    execFileSync(bin, [...prefixArgs, 'pack', `${name}@${version}`, '--pack-destination', tmp], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    const tgz = readdirSync(tmp).find((f) => f.endsWith('.tgz'));
    if (!tgz) {
      // No registry tarball yet (first publish of this version).
      // Not "stale" — there is nothing to compare against. Return
      // false so the publish proceeds.
      return false;
    }
    const regVer = readVersionJsFromTarballSilent(join(tmp, tgz), `registry ${name}@${version}`);
    if (regVer === null) return false;
    return localVer !== regVer;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
