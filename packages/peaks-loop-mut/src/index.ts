/**
 * peaks-loop-mut public surface.
 *
 * Re-exports the two slices this package owns:
 *  1. services/mut (mutation testing + assertion scanning + report)
 *  2. services/agent/ecc-cache-service (ECC tarball cache)
 *
 * Main peaks-loop package consumes these via `workspace:*` deps:
 *
 *   import { loadMutReport } from 'peaks-loop-mut';
 *   import { cleanupStaleCache } from 'peaks-loop-mut/services/agent/ecc-cache-service';
 */

export * from './services/mut/index.js';

export {
  setCacheDirPermissions,
  downloadToCache,
  readCacheManifest,
  listCachedAgents,
  readAgentSkill,
  cleanupStaleCache,
  ECC_REPO_OWNER,
  ECC_REPO_NAME,
  type CacheManifest,
  type DownloadResult,
} from './services/agent/ecc-cache-service.js';
