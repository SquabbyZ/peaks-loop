/**
 * The `data.reviewPlan` seam for `peaks sub-agent dispatch rd`.
 *
 * The RD review fan-out used to exist only as prose. This module derives the
 * plan from the request artifact's declared type through the one policy module
 * (`src/services/rd/reviewer-dispatch-policy.ts`) and refuses to guess: a
 * missing `--request-id`, a record that declares no `- type:` line, or a read
 * failure all yield `reviewPlan: null` plus a warning that names the reason.
 * The plan is envelope metadata only — it is never injected into the generated
 * prompt, so wiring it changes no sub-agent's instructions.
 */
import { getErrorMessage } from 'peaks-loop-shared/result';

import type { RequestType } from '../../services/artifacts/artifact-prerequisites.js';
import {
  REQUEST_ID_PATTERN,
  showRequestArtifact
} from '../../services/artifacts/request-artifact-service.js';
import { reviewPlanFor, type ReviewPlan } from '../../services/rd/reviewer-dispatch-policy.js';
import { CARRIER_ROLES } from '../../services/workflow/request-type-resolution.js';

/** The only dispatch role whose envelope carries a review plan. */
const REVIEW_PLAN_ROLE = 'rd';

const NO_REQUEST_ID =
  'review plan unavailable: no request id — pass --request-id <rid> so the reviewers are derived from the request type instead of guessed';
const TYPE_UNKNOWN =
  'review plan unavailable: request type unknown — no request artifact with a declared `- type:` line was found for --request-id, so the reviewers are not guessed';

export interface ReviewPlanInput {
  role: string;
  projectRoot: string;
  sessionId: string;
  requestId: string | undefined;
}

export interface ReviewPlanResolution {
  /**
   * `undefined` when the role has no plan at all (the key is then absent from
   * the envelope); `null` when the plan could not be derived.
   */
  readonly reviewPlan?: ReviewPlan | null;
  readonly warnings: readonly string[];
}

/**
 * The plan for this dispatch, or the reason it cannot be derived.
 */
export async function reviewPlanForDispatch(input: ReviewPlanInput): Promise<ReviewPlanResolution> {
  if (input.role !== REVIEW_PLAN_ROLE) {
    return { warnings: [] };
  }
  const requestId = input.requestId?.trim() ?? '';
  if (requestId.length === 0) {
    return { reviewPlan: null, warnings: [NO_REQUEST_ID] };
  }
  let requestType: RequestType | null;
  try {
    requestType = await readDeclaredRequestType(input.projectRoot, input.sessionId, requestId);
  } catch (error: unknown) {
    return {
      reviewPlan: null,
      warnings: [TYPE_UNKNOWN, `review plan read failed: ${getErrorMessage(error)}`]
    };
  }
  if (requestType === null) {
    return { reviewPlan: null, warnings: [TYPE_UNKNOWN] };
  }
  return { reviewPlan: reviewPlanFor(requestType), warnings: [] };
}

/**
 * The first carrier that exists answers, exactly as the canonical request-type
 * resolver reads the same order. A carrier that records no usable `- type:`
 * line answers `null` — an undeclared type is unknown, not the reader default.
 * Exported so the audit-plan seam reads the type through THIS function instead
 * of spelling the carrier order a second time.
 */
export async function readDeclaredRequestType(
  projectRoot: string,
  sessionId: string,
  requestId: string
): Promise<RequestType | null> {
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    return null;
  }
  for (const role of CARRIER_ROLES) {
    const artifact = await showRequestArtifact({ projectRoot, role, requestId, sessionId });
    if (artifact === null) continue;
    return artifact.requestTypeSource === 'declared' ? artifact.requestType : null;
  }
  return null;
}
