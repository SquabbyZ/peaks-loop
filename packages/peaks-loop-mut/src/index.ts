/**
 * peaks-loop-mut public surface.
 *
 * Re-exports the two slices this package owns:
 *  1. services/mut (mutation testing + assertion scanning + report)
 *  2. services/agent/ecc-package-service (ECC agents from the npm dependency)
 *
 * Main peaks-loop package consumes these via `workspace:*` deps:
 *
 *   import { loadMutReport } from 'peaks-loop-mut';
 *   import { installEccAgents } from 'peaks-loop-mut/services/agent/ecc-package-service';
 */

export * from './services/mut/index.js';

export {
  installEccAgents,
  eccPackageInfo,
  materializeEccAgents,
  readEccMaterializeManifest,
  listMaterializedAgents,
  hasMaterializedEccAgents,
  resolveMaterializedAgentName,
  readMaterializedAgent,
  listEccAgents,
  ECC_PACKAGE_NAME,
  ECC_MATERIALIZE_VERSION,
  EccSourceError,
  isSafeAgentName,
  resolveEccAgentsDir,
  resolveEccMaterializedDir,
  resolveEccMaterializedManifestPath,
  resolveEccPackageRoot,
  type EccInstallResult,
  type EccMaterializeManifest,
  type EccSourceFailure
} from './services/agent/ecc-package-service.js';
