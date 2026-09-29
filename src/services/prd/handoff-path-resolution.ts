/**
 * Slice `b1-filesplit-campaign` (wave 3) — verbatim extraction of the handoff
 * capsule PATH layer from `./handoff-service.ts` (the id guard, the rid-scoped
 * write path and the consumer-side resolver) so that module clears the 300
 * raw-line cap. No guard, no message string and no join changed;
 * `handoff-service.ts` re-exports both public names from its own path, so no
 * importer changed. The id->path escape this module guards is measured by
 * `tests/unit/runtime/no-runtime-input-guard.test.ts` rule D, whose scanned
 * module list now names this file next to `handoff-service.ts`.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { isUnsafePathInput } from '../../shared/path-safety.js';
import { REQUEST_ID_PATTERN } from '../artifacts/request-artifact-service.js';

/**
 * Both ids in a handoff path are caller-supplied path segments, so both are
 * checked at the join. Added 2026-09-14 (repair R1, security audit F2 of
 * `2026-09-14-cli-id-escape-instrumentation`).
 *
 * This function was introduced by `0536d5bd` — the commit that instrumented
 * this defect class — with neither id checked, and it sat outside rule D's
 * scanned layer, so the instrument could not see its own new member.
 * Measured on the pre-fix tree (`prd handoff init --apply`, temp project,
 * `ok: true` both times):
 *
 *   --rid '../../../../../../README'  replaced the project-root README.md
 *   --sid '../../../../SIDOUT'        wrote 4 levels above the project root
 *
 * The two axes need two different controls, for a recorded reason: the rid has
 * a pinned format (`REQUEST_ID_PATTERN`, no separator, no dot-dot, no drive)
 * and the sid has none, so it gets the segment check. `isUnsafePathInput`
 * alone is NOT enough for the rid — it admits `a/b` (two non-empty segments),
 * which `request-artifact-service.ts` would reject.
 *
 * Guarding HERE rather than at the three `prd`/`env` flags means every producer
 * that writes through this constructor — `initHandoff`'s default,
 * `handoff-auto-regen.ts`, `evidence-generator.ts` — is covered by the join
 * itself, not by each caller re-deciding.
 */
function assertSafeHandoffIds(sessionId: string, requestId: string): void {
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new Error(
      `Invalid request id: ${requestId} (expected letters, digits, dots, underscores, or dashes)`
    );
  }
  if (isUnsafePathInput(sessionId)) {
    throw new Error(`Invalid session id: ${sessionId} (must be a single path segment)`);
  }
}

/**
 * The canonical capsule path for ONE SLICE, relative to the project root.
 *
 * Slice `2026-09-14-prd-capsule-rid-scoping`: the capsule used to be one slot
 * per SESSION (`prd/handoff.md`), so the second slice's handoff silently
 * overwrote the first slice's — and `AUDIT_REQUIRES_HANDOFF` stayed green
 * because it never checked WHOSE rid the file named. Measured on
 * `2026-09-13-session-21878f`: a four-slice job passed that prerequisite on a
 * capsule left by a different line of work.
 *
 * This is the WRITE target, so it always carries the rid — a consumer-side
 * fallback here would leave a rid-scoped requirement with a bare-name writer,
 * which is the defect shape this slice exists to remove. Readers that must
 * tolerate pre-rid-scoping sessions call `resolveHandoffPath` instead.
 */
export function handoffRelativePath(sessionId: string, requestId: string): string {
  assertSafeHandoffIds(sessionId, requestId);
  return join('.peaks', '_runtime', sessionId, 'prd', `handoff-${requestId}.md`);
}

/**
 * The capsule a CONSUMER should read for (session, requestId): the rid-scoped
 * path when it is on disk, else the pre-rid-scoping bare name. Returns null
 * when neither exists.
 *
 * Three sessions on disk still hold only the bare file
 * (`2026-09-06-session-a87ca4`, `2026-09-12-session-e37ef0`,
 * `2026-09-13-session-21878f`), so the legacy tier has to keep resolving for
 * the gate and for every reader below.
 *
 * `requestId` is optional because the detect-only audit surface reaches its
 * service without one. Such a caller can name only the bare path: a session
 * holding nothing but rid-scoped capsules reports missing rather than picking
 * among its siblings' capsules, which would re-open the cross-slice mix-up
 * this scoping exists to close (fail closed, not "some capsule is there").
 */
export function resolveHandoffPath(opts: {
  projectRoot: string;
  sessionId: string;
  requestId?: string;
}): string | null {
  // The legacy bare-name candidate below is a second join of the same sid, in a
  // second function, so it needs the sid guarded in its own right — the
  // optional-requestId branch reaches `handoffRelativePath` (guarded there), but
  // the branch that is taken when a caller has NO rid reaches this join only.
  if (isUnsafePathInput(opts.sessionId)) {
    throw new Error(`Invalid session id: ${opts.sessionId} (must be a single path segment)`);
  }
  const candidates = [
    ...(opts.requestId !== undefined ? [handoffRelativePath(opts.sessionId, opts.requestId)] : []),
    join('.peaks', '_runtime', opts.sessionId, 'prd', 'handoff.md')
  ];
  for (const relative of candidates) {
    const absolute = join(opts.projectRoot, relative);
    if (existsSync(absolute)) return absolute;
  }
  return null;
}
