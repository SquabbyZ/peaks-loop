/**
 * Canonical session-directory resolver.
 *
 * As of slice 2026-06-05-peaks-runtime-layer the per-session workspace
 * lives at `<root>/.peaks/_runtime/<sessionId>/` (NOT at the legacy
 * `<root>/.peaks/_runtime/<sessionId>/` location). All **write** paths MUST route
 * through this helper. The legacy top-level path is preserved as a
 * back-compat **read** fallback only (see
 * `src/services/artifacts/request-artifact-service.ts:662` etc.).
 *
 * The corresponding test in
 * `tests/unit/services/session/session-dir-canonical.test.ts` enforces
 * two invariants:
 *
 *   (a) `getSessionDir(root, sid)` returns `<root>/.peaks/_runtime/<sid>`.
 *   (b) A static scan of `src/` flags any direct join of `.peaks` +
 *       `sessionId` that does NOT route through this resolver. The
 *       back-compat **read** sites are excluded by explicit allow-list.
 *
 * @param projectRoot - Absolute path to the project root.
 * @param sessionId - The session identifier (e.g. `2026-06-06-session-5b1095`).
 * @returns Absolute path to the canonical session directory.
 */
import { join } from 'node:path';

export function getSessionDir(projectRoot: string, sessionId: string): string {
  return join(projectRoot, '.peaks', '_runtime', sessionId);
}
