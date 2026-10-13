import { emitObservabilityEvent } from '../observability/observability-service.js';
import type { PrerequisiteCheckResult } from './artifact-prerequisites.js';
import type { RequestArtifactRole } from './artifact-templates.js';
import type { RequestArtifactState } from './request-artifact-state-helpers.js';

/**
 * Slice C of v2.11.1 — observability hook #7/7. Fire-and-forget per PRD Q4. The
 * synchronous emit never throws and never blocks the prereq check's return
 * value.
 *
 * Split out when `checkPrerequisites` gained the `emitEvents: false` opt-out:
 * the emit and the decision to skip it are one story, and the caller is over its
 * file-size cap. Body moved verbatim.
 */
export function emitPrereqTransitionEvent(opts: {
  projectRoot: string;
  sessionId: string;
  role: RequestArtifactRole;
  newState: RequestArtifactState;
  requestId: string;
  result: PrerequisiteCheckResult;
}): void {
  if (opts.sessionId === undefined) return;
  emitObservabilityEvent(
    {
      schemaVersion: 1,
      ts: new Date().toISOString(),
      sessionId: opts.sessionId,
      category: 'slice-transition',
      sliceRid: opts.requestId,
      detail: {
        artifactRole: opts.role,
        to: opts.newState,
        prereqOk: opts.result.ok,
        missingCount: opts.result.missing.length
      }
    },
    { projectRoot: opts.projectRoot }
  );
}
