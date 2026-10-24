/**
 * The canonical presence write — AWAITED, and fail-closed.
 *
 * WHY THIS IS A MODULE OF ITS OWN. `skill-presence-service.ts` is over the
 * repository's 300-line cap (a ratchet that may only go DOWN), and the
 * canonical write is exactly the part that had to change: it used to run
 * inside a non-awaited `void (async () => { ... catch {} })()`, so a graph
 * that could not be built — or a lease that could not be written — was
 * swallowed and the caller was handed a success-shaped envelope anyway.
 * The write lives here now, the caller AWAITS it, and a failure ESCAPES
 * with a typed code instead of vanishing.
 *
 * WHAT IT DOES NOT DO. It does not decide the session, the mode or the
 * gate — the caller resolved those before it got here. It does not build
 * the legacy `SkillPresence` envelope either; that stays in the service.
 *
 * THE LAZY IMPORT IS DELIBERATE. `presence-lease-service` and the caller-id
 * resolver are imported DYNAMICALLY so the cold path of the legacy READ
 * side (`getSkillPresence` / `checkStalePresence` /
 * `clearStalePresenceOnRotation`) does not pull the canonical lease and
 * the adapter machinery into module load.
 */

import { getErrorMessage } from 'peaks-loop-shared/result';
import { presenceError } from './presence-lease-store.js';

/**
 * The caller-id prefix cap. `wf-` + <callerId prefix> + `-compat` has to
 * stay under the 200-char `WORKFLOW_ID_REGEX` cap, so the caller id is cut
 * at 189 characters.
 */
const CALLER_ID_PREFIX_CAP = 189;

/** What the canonical write needs. */
export interface CanonicalPresenceWriteInput {
  /** The canonical project root the lease and the graph are written under. */
  readonly projectRoot: string;
  /** The bound session id — the lease is scoped to it. */
  readonly sessionId: string;
  /**
   * The caller id the caller already resolved. When it is absent the write
   * resolves one itself; when THAT fails the write fails closed with
   * `PEAKS_CALLER_NOT_RESOLVED` — a lease is never written for nobody.
   */
  readonly callerId?: string | undefined;
  /** The skill that owns the presence. */
  readonly skill: string;
  /** The timestamp stamped onto the lease. */
  readonly now: string;
  /** The execution mode, already normalized by the caller. */
  readonly mode?: string | undefined;
  /** The gate, already normalized by the caller. */
  readonly gate?: string | undefined;
}

/** What the canonical write produced. */
export interface CanonicalPresenceWriteResult {
  /** The workflow id the lease and the graph are keyed by. */
  readonly workflowId: string;
  /** The graph the lease names. */
  readonly graphRef: string;
}

/**
 * Write the canonical presence lease.
 *
 * The graph the lease names is written FIRST (inside
 * `presence-lease-service.setPresenceLease`), so no lease is ever left
 * pointing at a graph that does not exist. When the graph cannot be built
 * or the lease cannot be written, the failure ESCAPES this function: the
 * caller sees it and reports it. Nothing is swallowed here.
 */
export async function writeCanonicalPresenceLease(
  input: CanonicalPresenceWriteInput
): Promise<CanonicalPresenceWriteResult> {
  const [{ resolveCallerProjection }, leaseMod] = await Promise.all([
    import('../session/resolve-caller-id.js'),
    import('./presence-lease-service.js')
  ]);
  let callerId = input.callerId;
  if (callerId === undefined) {
    try {
      callerId = resolveCallerProjection({
        projectRoot: input.projectRoot,
        env: process.env
      }).callerId;
    } catch (error: unknown) {
      // The resolver reports `EX_USAGE`; the write path reports the
      // canonical `PEAKS_CALLER_NOT_RESOLVED` instead, so this failure is
      // recognizable as a CALLER failure and not as a write failure.
      throw presenceError(
        'PEAKS_CALLER_NOT_RESOLVED',
        `Could not resolve a callerId for the presence write: ${getErrorMessage(error)}`
      );
    }
  }
  const workflowId = `wf-${callerId.slice(0, CALLER_ID_PREFIX_CAP)}-compat`;
  const graphRef = `graphs/${workflowId}.json`;
  leaseMod.setPresenceLease({
    projectRoot: input.projectRoot,
    sessionId: input.sessionId,
    callerId,
    workflowId,
    graphRef,
    skill: input.skill,
    now: input.now,
    ...(input.mode !== undefined ? { mode: input.mode } : {}),
    ...(input.gate !== undefined ? { gate: input.gate } : {})
  });
  return { workflowId, graphRef };
}
