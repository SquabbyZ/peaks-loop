/**
 * `src/services/observability/near-miss-attempts.ts`
 *
 * The prereq ATTEMPTS a slice's events record, and the failures among them
 * that were never satisfied.
 *
 * WHY A SEPARATE MODULE. The near-miss metric needs to know, for one slice,
 * which prereq checks FAILED and which of those failures were later satisfied.
 * That is a reading of the event stream, and it is the reading that the
 * `prereq-skipped` reason is built on — so it lives next door, and
 * `near-miss.ts` holds the metric.
 *
 * WHY THE STREAM HOLDS TWO EVENTS PER ATTEMPT. A transition attempt produces
 * TWO `slice-transition` events: the one the prereq check itself emits,
 * carrying the verdict (`{artifactRole, to, prereqOk, missingCount}`), and the
 * one the transition emits after the artifact is written, carrying the
 * arrival (`{from, to, artifactRole}`) and NO verdict. Reading the second as
 * an attempt would double-count every attempt and pair a failure with an
 * unrelated transition, so the attempt IS the verdict event and the verdict
 * -less one is ignored.
 *
 * WHY A FAILURE THAT WAS LATER SATISFIED IS NOT A NEAR-MISS. A prereq check
 * that REFUSES a transition is a gate doing its job: the agent does the work,
 * the check is run again, and it passes. Counting that as "a check that was
 * skipped" counts a working gate as a broken one. So a failure counts only
 * when NO later attempt at the same transition key succeeded — the check was
 * never satisfied on the way to the verdict.
 *
 * WHY THE TRANSITION KEY IS `artifactRole -> to`. A retry re-runs the SAME
 * check: the same artifact role, moving to the same state. Pairing on the key
 * is what says "this later success answered that earlier failure". Pairing
 * on time alone would pair a failure with any later success, including one
 * for a different transition.
 */

import type { ObservabilityEvent } from './observability-service.js';

/** One prereq verdict the stream recorded for a transition attempt. */
export type PrereqAttempt = {
  /** The position of the attempt in the slice's event stream. */
  readonly index: number;
  /** The transition key: `artifactRole -> to`. */
  readonly key: string;
  /** Whether the check passed. */
  readonly passed: boolean;
  readonly sessionId: string;
  readonly ts: string;
};

/**
 * The transition key an event belongs to, or null when it names no transition.
 *
 * The key is the pair that identifies the CHECK, not the attempt: a retry
 * re-runs the same check, so the key is what pairs a failure with the
 * success that later answered it.
 */
export function attemptKey(event: ObservabilityEvent): string | null {
  const detail = event.detail as { artifactRole?: unknown; to?: unknown };
  const role = typeof detail.artifactRole === 'string' ? detail.artifactRole : null;
  const to = typeof detail.to === 'string' ? detail.to : null;
  if (role === null || to === null) return null;
  return `${role} -> ${to}`;
}

/**
 * The prereq verdict an event carries, or null when it carries none.
 *
 * `null` is the verdict-LESS event: the transition itself, which says where
 * the slice went but nothing about whether the check let it go.
 */
export function prereqVerdictOf(event: ObservabilityEvent): boolean | null {
  const detail = event.detail as { prereqOk?: unknown };
  return typeof detail.prereqOk === 'boolean' ? detail.prereqOk : null;
}

/** The attempts a slice's events record, in stream order. */
export function collectAttempts(events: readonly ObservabilityEvent[]): readonly PrereqAttempt[] {
  const attempts: PrereqAttempt[] = [];
  for (const [index, event] of events.entries()) {
    if (event.category !== 'slice-transition') continue;
    const verdict = prereqVerdictOf(event);
    if (verdict === null) continue;
    const key = attemptKey(event);
    if (key === null) continue;
    attempts.push({ index, key, passed: verdict, sessionId: event.sessionId, ts: event.ts });
  }
  return attempts;
}

/**
 * The failures that were NEVER satisfied on the way to the verdict.
 *
 * Three conditions, and each of them is load-bearing:
 *
 *   - the check FAILED (`prereqOk === false`);
 *   - the failure happened BEFORE the verdict — a check that fires after the
 *     slice already passed is a later round, not a pass bought by a skip;
 *   - no LATER attempt at the SAME transition key succeeded — the check was
 *     never satisfied, so the slice reached the verdict without it.
 *
 * The last condition is the one that separates a refusal that was then
 * satisfied (a gate working) from a check that was never satisfied.
 */
export function unrecoveredFailures(
  attempts: readonly PrereqAttempt[],
  verdictIndex: number | null
): readonly PrereqAttempt[] {
  if (verdictIndex === null) return [];
  return attempts.filter(
    (attempt) =>
      !attempt.passed &&
      attempt.index < verdictIndex &&
      !attempts.some(
        (later) => later.index > attempt.index && later.key === attempt.key && later.passed
      )
  );
}
