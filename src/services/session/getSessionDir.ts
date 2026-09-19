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
 * `sessionId` is the last caller-supplied segment of every session-scoped
 * path here, so its segment check lives at this join rather than being
 * re-derived at each call site: `../../x` used to be joined verbatim, and
 * the CLI wrote outside the project root while still returning `ok: true`.
 *
 * The predicate is `isUnsafePathInput`, NOT `SESSION_ID_PATTERN` /
 * `validateSessionId`. The latter are stricter than the segment axis and
 * reject ids that are legal today (`sid-1`, a request id reused as the
 * session-dir name), so adopting them would change results for
 * well-formed callers.
 *
 * Not covered, recorded rather than implied: the `\0` axis
 * (`isUnsafePathInput` admits a NUL, and `execFileSync` raises EINVAL
 * before it can be exercised), and callers that hand-roll
 * `join(root, '.peaks', '_runtime', sid, ...)` instead of calling this.
 *
 * @param projectRoot - Absolute path to the project root.
 * @param sessionId - The session identifier (e.g. `2026-06-06-session-5b1095`).
 * @returns Absolute path to the canonical session directory.
 * @throws Error when `sessionId` is not a single path segment.
 */
import { join } from 'node:path';
import { isUnsafePathInput } from '../../shared/path-safety.js';

export function getSessionDir(projectRoot: string, sessionId: string): string {
  // Throwing, not `null` / a tagged result: those widen the return type
  // to `string | null` and make every call site handle a bad id — the
  // per-site slice this guard replaces. This is also the shape the repo
  // already refuses with, and a caller cannot forget to handle a throw.
  if (isUnsafePathInput(sessionId)) {
    throw new Error(`Invalid session id: ${sessionId} (must be a single path segment)`);
  }
  return join(projectRoot, '.peaks', '_runtime', sessionId);
}

/**
 * The TOTAL entry to the same axis. Same predicate, same path; the only
 * difference is that this one is total — it never throws.
 *
 * WHY TWO ENTRIES RATHER THAN ONE. The partial entry above is correct
 * for a caller that cannot proceed without a session dir: a throw is
 * the one failure a caller cannot forget to handle. It is the WRONG
 * shape for a frame whose own doc promises never to throw — the
 * statusline, the fire-and-forget telemetry writer, the best-effort
 * probe. Each of those frames had to wrap the partial entry in a
 * `try { } catch { return null }`, and that swallow cannot be told
 * apart from a real "there is nothing here" answer. Measured on the
 * compact backoff (`auto-compact-lifecycle.ts`), the conflation turned
 * an unresolvable id into the ADMIT branch and re-opened a dispatch
 * that the open run should have suppressed.
 *
 * The split does NOT make a swallow unwriteable — TypeScript has no
 * checked exceptions, so nothing here can. It makes the swallow
 * UNNECESSARY at a named place, and it gives every checker a stable
 * name to key on: a frame that degrades must say so by calling this
 * function, and the degrading branch (`ok: false`) is then a value the
 * caller has to handle rather than a `catch` nobody reads.
 *
 * `reason` is a single-line English sentence fit for an envelope — no
 * stack traces, no CLI verbs (see `human-nl-choice-only-tenet`).
 */
export function tryGetSessionDir(
  projectRoot: string,
  sessionId: string
): { readonly ok: true; readonly dir: string } | { readonly ok: false; readonly reason: string } {
  // Deliberately NOT `try { return {ok:true, dir: getSessionDir(...)} } catch`.
  // That would re-introduce the swallow this function exists to remove, and it
  // would also catch a throw from `join` for reasons that are not a bad id.
  if (isUnsafePathInput(sessionId)) {
    return {
      ok: false,
      reason: `Invalid session id: ${sessionId} (must be a single path segment)`
    };
  }
  return { ok: true, dir: join(projectRoot, '.peaks', '_runtime', sessionId) };
}
