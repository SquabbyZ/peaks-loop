/**
 * The `data.auditPlan` seam for `peaks sub-agent dispatch rd`.
 *
 * The plan itself is declared in `src/services/rd/stack-dimensions.ts`; this
 * module is only the wiring: read the request type through the SAME reader the
 * review plan uses, derive the stack profile from the existing
 * `scanArchetype` report, and refuse to guess. No request id, an undeclared
 * type, or a failed archetype scan all yield `auditPlan: null` plus a warning
 * that names the reason; a scan that succeeds with no stack signal yields a
 * `generic` plan with an empty `added` list.
 */
import { getErrorMessage } from 'peaks-loop-shared/result';

import type { RequestType } from '../../services/artifacts/artifact-prerequisites.js';
import { scanArchetype } from '../../services/scan/archetype-service.js';
import type { ArchetypeReport } from '../../services/scan/scan-types.js';
import {
  buildAuditPlan,
  resolveStackProfile,
  type AuditPlan
} from '../../services/rd/stack-dimensions.js';
import { readDeclaredRequestType } from './dispatch-review-plan.js';

/** The only dispatch role whose envelope carries an audit plan. */
const AUDIT_PLAN_ROLE = 'rd';

const NO_REQUEST_ID =
  'audit plan unavailable: no request id — pass --request-id <rid> so the stack profile is attached to a request instead of guessed';
const TYPE_UNKNOWN =
  'audit plan unavailable: request type unknown — no request artifact with a declared `- type:` line was found for --request-id';

export interface AuditPlanInput {
  role: string;
  projectRoot: string;
  sessionId: string;
  requestId: string | undefined;
}

export interface AuditPlanResolution {
  /**
   * `undefined` when the role has no plan at all (the key is then absent from
   * the envelope); `null` when the plan could not be derived.
   */
  readonly auditPlan?: AuditPlan | null;
  readonly warnings: readonly string[];
}

/** The shared input both dispatch plans read, so one call site builds it once. */
export function planInputFor(
  role: string,
  ctx: { projectRoot: string; sid: string },
  options: { requestId?: string }
): AuditPlanInput {
  return { role, projectRoot: ctx.projectRoot, sessionId: ctx.sid, requestId: options.requestId };
}

/** The plan for this dispatch, or the reason it cannot be derived. */
export async function auditPlanForDispatch(input: AuditPlanInput): Promise<AuditPlanResolution> {
  if (input.role !== AUDIT_PLAN_ROLE) {
    return { warnings: [] };
  }
  const requestId = input.requestId?.trim() ?? '';
  if (requestId.length === 0) {
    return { auditPlan: null, warnings: [NO_REQUEST_ID] };
  }
  let requestType: RequestType | null;
  try {
    requestType = await readDeclaredRequestType(input.projectRoot, input.sessionId, requestId);
  } catch (error: unknown) {
    return {
      auditPlan: null,
      warnings: [TYPE_UNKNOWN, `audit plan read failed: ${getErrorMessage(error)}`]
    };
  }
  if (requestType === null) {
    return { auditPlan: null, warnings: [TYPE_UNKNOWN] };
  }
  let report: ArchetypeReport;
  try {
    report = await scanArchetype({ projectRoot: input.projectRoot });
  } catch (error: unknown) {
    return {
      auditPlan: null,
      warnings: [`audit plan unavailable: archetype scan failed: ${getErrorMessage(error)}`]
    };
  }
  const { profile, reason } = resolveStackProfile(report);
  const plan = buildAuditPlan(profile, requestType);
  const warnings =
    profile === 'generic' ? [`audit plan profile is generic (${reason}); no dimensions added`] : [];
  return { auditPlan: plan, warnings };
}
