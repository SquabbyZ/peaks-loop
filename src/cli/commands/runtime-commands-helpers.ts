/**
 * Internal helpers for the adapter-registry path used by
 * `peaks adapter register|list`. Extracted from runtime-commands.ts
 * after Task 1.7 (design §13.1) retired the `peaks runtime compact`
 * dispatch — the registry plumbing is still used by the
 * adapter-registration CLI, so it lives here as a stand-alone module
 * rather than re-attaching to the retired dispatch surface.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { AdapterRegistry } from '../../services/adapter/adapter-registry.js';

/** Internal helper exposed for tests + future programmatic callers:
 *  resolve the registry file location, ensuring the parent dir
 *  exists. Idempotent. */
export function ensureRegistryDir(registryFile: string): void {
  mkdirSync(dirname(registryFile), { recursive: true });
}

/** Internal helper for tests: locate the registry file under the
 *  given project root. Thin wrapper so tests can stub the resolution. */
export function registryFileFor(projectRoot: string): string {
  const f = AdapterRegistry.defaultFile(projectRoot);
  ensureRegistryDir(f);
  return f;
}
