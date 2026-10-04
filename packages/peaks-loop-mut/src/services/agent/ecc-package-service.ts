/**
 * `peaks ecc` service — ECC agent definitions, read from the
 * `ecc-universal` npm dependency.
 *
 * Facade for the split modules beside it. It keeps one job: hand the CLI and the
 * dispatch layer a stable view of the agents, and state plainly when ECC is not
 * present. There is no download, no cache manifest, no sha-keyed directory and no
 * TTL sweep in this design — a dependency is already on disk. Where each concern
 * went:
 *
 *   - `ecc-fetch.ts` (GitHub release JSON + codeload tarball) — deleted. Its
 *     premise, "`affaan-m/ECC` is not on npm", was false.
 *   - `ecc-archive-safety.ts` (tar entry allowlist, symlink/`..`/device refusal)
 *     — deleted. Nothing is unpacked from an archive anymore; the filename
 *     whitelist that guarded the write target survives as `isSafeAgentName`.
 *   - `ecc-cache-manifest.ts` (`ecc-installed.json`, the active-sha pointer) —
 *     deleted; the only manifest left is the materialize manifest, which records
 *     the package version.
 *   - `ecc-cache-cleanup.ts` and the retention leg that called it (7-day sweep of
 *     `~/.peaks/cache/ecc-<sha>/`) — deleted. There is no cache to expire.
 *
 * No subprocess is spawned and no network request is made by any code path here.
 */

import { resolveEccAgentsDir, type EccInstallResult } from './ecc-package-source.js';
import { materializeEccAgents } from './ecc-materialize.js';

/**
 * Land the plugin-free copy of the bundled ECC agents.
 *
 * Idempotent: it re-copies from the package and rewrites the manifest, so
 * `peaks ecc install` after a peaks-loop upgrade picks up the new agent set and
 * prunes what the new version dropped. Throws `EccSourceError` when the
 * dependency is missing — the caller renders that as a reinstall instruction,
 * which is the only action a user can actually take.
 */
export function installEccAgents(): EccInstallResult {
  resolveEccAgentsDir();
  return materializeEccAgents();
}

export {
  ECC_PACKAGE_NAME,
  ECC_MATERIALIZE_VERSION,
  EccSourceError,
  isSafeAgentName,
  readEccPackageVersion,
  resolveEccAgentsDir,
  resolveEccMaterializedDir,
  resolveEccMaterializedManifestPath,
  resolveEccPackageRoot,
  type EccInstallResult,
  type EccMaterializeManifest,
  type EccSourceFailure
} from './ecc-package-source.js';
export { materializeEccAgents } from './ecc-materialize.js';
export {
  readEccMaterializeManifest,
  listMaterializedAgents,
  hasMaterializedEccAgents,
  resolveMaterializedAgentName,
  readMaterializedAgent,
  listEccAgents
} from './ecc-materialized-readers.js';
