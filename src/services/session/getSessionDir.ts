/**
 * Canonical session-directory resolver.
 *
 * As of slice 2026-06-05-peaks-runtime-layer the per-session workspace
 * lives at `<root>/.peaks/_runtime/<sessionId>/`, NOT at the legacy
 * `<root>/.peaks/<sessionId>/` location. All **write** paths MUST route
 * through this helper. The legacy top-level path survives only as a
 * back-compat **read** fallback (see `legacySessionRoot` in
 * `src/services/artifacts/artifact-prerequisites.ts` and `sessionOwnsSlice`
 * in `src/services/sc/sc-service.ts`).
 *
 * `tests/unit/services/session/session-dir-canonical.test.ts` enforces
 * three invariants:
 *
 *   (a) `getSessionDir(root, sid)` returns `<root>/.peaks/_runtime/<sid>`.
 *   (b) A static scan of `src/**` flags any `join()` chain that names
 *       `.peaks` plus a session id without routing through this resolver,
 *       wherever the id sits in the chain. The back-compat **read** sites
 *       are exempted by an allow-list whose entries are asserted to be
 *       load-bearing (an inert entry fails the scan).
 *   (c) A static scan of every markdown file under `skills/` flags a
 *       legacy `.peaks/<sid>/...` artifact path that a sub-agent would
 *       follow verbatim.
 *
 * @param projectRoot - Absolute path to the project root.
 * @param sessionId - The session identifier (e.g. `2026-06-06-session-5b1095`).
 * @returns Absolute path to the canonical session directory.
 */
import { join } from 'node:path';

export function getSessionDir(projectRoot: string, sessionId: string): string {
  return join(projectRoot, '.peaks', '_runtime', sessionId);
}
