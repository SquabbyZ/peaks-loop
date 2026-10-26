import { emitObservabilityEvent } from '../observability/observability-service.js';
import { ownerSkillForPath } from '../observability/owner-skill-map.js';
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
        missingCount: opts.result.missing.length,
        // The LIST, not only its length: the count says how many artifacts were
        // missing, and the list says which ones and which skill owns each, so a
        // reader can name the skill that failed to deliver. Ownership is per
        // missing item; an aggregate owner is the reader's job, not the
        // writer's.
        missing: opts.result.missing.map((m) => ({
          path: m.path,
          description: m.description,
          kind: m.kind,
          ownerSkill: ownerSkillForPath(m.path)
        }))
      }
    },
    { projectRoot: opts.projectRoot }
  );
}
