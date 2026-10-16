/**
 * Which request type this rid declares — DERIVED, so no caller can get it wrong.
 *
 * WHY THIS EXISTS. `verifyPipeline` took the request type as an option and fell
 * back to `feature` when it was absent. The two callers that matter both left it
 * absent — `peaks workflow verify-pipeline` passes it only when a human types
 * `--type`, and `slice-check` never passes it — so the CHECKER read every rid as
 * `feature` while the commit-time carrier read the rid's own `- type:` line and
 * got it right. For a docs or chore request those two readers disagreed on the
 * same tree: `verify-pipeline` reported three RD-evidence violations and
 * `complete: false`, and the commit leg reported the contract satisfied.
 *
 * That is the same defect one layer up from the gate list: two layers answering
 * one question, each with its own answer. So the answer is derived here, in ONE
 * place, and every caller inherits it — `--type` stays as the explicit override.
 *
 * THE RULE IS THE CARRIER'S OWN, deliberately. `CARRIER_ROLES` is the order
 * `.husky/pipeline/contract-verdict.mjs` enumerates a rid's carriers in
 * (`CARRIER_DIRS`), and the first carrier that exists answers — including when its
 * answer is the reader's substituted default, which is what that leg does with an
 * unusable or absent `- type:` line.
 *
 * THE SCOPE IS THE CARRIER'S OWN TOO, AND THAT PART CAME SECOND. Matching the
 * ORDER while scanning every directory under `.peaks/_runtime/` was a security
 * defect, not a style question: a directory whose name sorted before the rid's
 * session won, so anyone able to create one file under `.peaks/_runtime/` could
 * choose ANY rid's gate table — silently, with the type looking like an ordinary
 * derivation. Measured before the fix: a docs rid read as `feature`, `complete`
 * true → false, with an empty 16-byte file in a directory beside it.
 *
 * So a carrier is read from a SESSION and never from a bare directory: the caller's
 * session when it named one, else the canonical binding's, else the fail-closed
 * default. Two further review rounds measured what the middle grounds cost — a
 * session chosen by its directory NAME, then a directory named after the request
 * itself, read as the EVIDENCE scope — and each is now shut off in the module that
 * owns that axis. See `sessionsToRead` and, for the evidence half,
 * `pipeline-verify-service.ts`'s empty-scope guard.
 *
 * WHAT "READS NOTHING" COVERS, STATED EXACTLY: the type (this module), the request
 * artifact (`findRequestFile`, which answers null for a null scope), and the
 * evidence (`resolveRdEvidencePaths` / `resolveQaEvidencePaths`, which are handed
 * an empty gate list). All three axes, or the sentence is the kind of comment this
 * slice exists to remove.
 */

import {
  DEFAULT_REQUEST_TYPE,
  isRequestType,
  type RequestType
} from '../artifacts/artifact-prerequisites.js';
import { showRequestArtifact } from '../artifacts/request-artifact-service.js';
import { getSessionIdCanonical } from '../session/session-manager.js';
import { SKIPPABLE_TYPES } from './workflow-skip-service.js';

/**
 * The rid's carriers, in the order the commit-time leg reads them: the RD request
 * is the slice's own record, and a PRD- or QA-only rid still answers.
 *
 * EXPORTED FOR ITS PARITY ARM, and that is not decoration. These three roles and
 * `.husky/pipeline/contract-verdict.mjs`'s `CARRIER_DIRS` are two literals held
 * equal by a comment, which is the duplicate-derivation pattern this whole line of
 * work exists to remove. They cannot be one literal without a layering inversion —
 * the hook reads `src/` dynamically and lazily, and `src/` may not read `.husky/` —
 * so an arm asserts the equality instead, and a reorder on either side reddens it.
 */
export const CARRIER_ROLES = ['rd', 'prd', 'qa'] as const;

/**
 * Whether a skip may be HONOURED for a request of this type — the request-type
 * rule, asserted again when a skip is READ.
 *
 * WHY THE READ RE-ASSERTS IT. `isWorkflowSkipState` validates field PRESENCE only;
 * the three write-time rules (this allowlist, one-time, caller kind) live in
 * `canSkipSlice`, so a hand-planted file satisfies the shape and none of the rules.
 * Measured: a planted file flipped the commit leg from refusing a FEATURE rid with
 * six missing artifacts to passing it. A reader that acts on the record is trusting
 * a carrier, which is the thing this line of work exists to stop.
 *
 * It lives here, beside the request type, because the rule IS a statement about the
 * request type; it reuses `SKIPPABLE_TYPES` rather than respelling the allowlist.
 * WHAT IT CANNOT DO: for a type the allowlist permits the record IS the
 * authorization, and a reader cannot tell a planted one from a written one — the
 * measured axis is the forbidden one, and the residual is in the RD artifact.
 */
export function mayHonourSkip(requestType: RequestType): boolean {
  return SKIPPABLE_TYPES.includes(requestType);
}

/**
 * What a caller is told when no scope resolves — the refusal names itself and
 * names the remedy, rather than reporting a missing artifact nobody can act on.
 */
export const NO_SESSION_SCOPE =
  'No session scope resolved: name one with --session-id <id>, or run inside a tree that has a peaks session binding. Nothing is read without one — not a carrier from some other directory, and not evidence from a directory named after this request.';

/**
 * The one session this rid's carriers may be read from: the caller's, or the
 * canonical binding's. NOTHING when neither resolves.
 *
 * WHY NOTHING, AND NOT A LIST OF "RECOGNISED" SESSIONS. An earlier version fell
 * back to `discoverSessions` when no session resolved — and "recognised" is a
 * DIRECTORY NAME (`/^\d{4}-\d{2}-\d{2}-session-[a-f0-9]+$/`) sorted ascending, so
 * a writer-chosen name decided the gate table on any tree where no session
 * resolved; measured through the CLI, that turned a refused rid into
 * `complete: true` with no violations. A name is not a proof of which session is
 * being verified, and an unbound tree cannot say — so the answer is the
 * fail-closed default, and the caller names the session when it knows one.
 */
function sessionsToRead(request: {
  projectRoot: string;
  sessionId?: string | null | undefined;
}): ReadonlyArray<string> {
  const named = request.sessionId ?? getSessionIdCanonical(request.projectRoot);
  return named === null ? [] : [named];
}

/**
 * The type of `rid`, or `request.requestType` when that is a request type.
 *
 * `request.requestType` is the caller's `--type`: an explicit, validated override.
 * It is checked against the same membership rule the artifacts layer uses, so a
 * typo falls through to the derivation rather than selecting a table by accident.
 *
 * The parameter is the request's own identity, which is what every caller already
 * has to hand — so no caller has to remember a separate argument.
 */
export async function resolveRequestType(request: {
  projectRoot: string;
  rid: string;
  /** The caller's `--type`, when it passed one. */
  requestType?: string;
  /** The session the caller is working in, when it named one. `null` is a
   *  resolved answer too: it means no scope could be resolved. */
  sessionId?: string | null | undefined;
}): Promise<RequestType> {
  if (isRequestType(request.requestType ?? '')) return request.requestType as RequestType;
  for (const sessionId of sessionsToRead(request)) {
    for (const role of CARRIER_ROLES) {
      const artifact = await showRequestArtifact({
        projectRoot: request.projectRoot,
        role,
        requestId: request.rid,
        sessionId
      });
      if (artifact === null) continue;
      return artifact.requestType;
    }
  }
  return DEFAULT_REQUEST_TYPE;
}
