/**
 * `src/services/observability/near-miss-attempts.ts`
 *
 * The prereq ATTEMPTS a slice's events record, the moment the slice was
 * declared PASSING, and the keys whose check was still unsatisfied at that
 * moment.
 *
 * WHY A SEPARATE MODULE. The near-miss metric needs to know, for one slice,
 * when it was declared passing and which required checks had not been
 * satisfied by then. That is a reading of the event stream, and it is the
 * reading the `prereq-skipped` reason is built on — so it lives next door, and
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
 * WHY THE REFERENCE MOMENT IS THE SUCCESSFUL PASS. The question the near-miss
 * literature asks is "at the moment the slice was declared passing, had the
 * required check been satisfied?" — so the reference is the PASS, not the
 * first `verdict-issued` event and not the last attempt at a key. A
 * `verdict-issued` attempt whose prereq check FAILED is not a pass at all; it
 * is a refused transition recorded under the same `to` state. The pass moment
 * is therefore the first `verdict-issued` attempt whose prereq check
 * SUCCEEDED, and a slice with no such attempt never passed — it is in
 * neither the numerator nor the denominator.
 *
 * WHY A KEY IS "UNSATISFIED" RATHER THAN "FAILED". A check that refused and
 * was then satisfied on a retry is a gate working as designed, and the
 * earlier question ("was there ever a failure?") cannot tell the two apart.
 * What the near-miss question asks is whether the key was satisfied WHEN THE
 * SLICE PASSED — and a key whose only successful attempt comes after the pass
 * moment was still unsatisfied at the moment the slice was declared passing.
 *
 * WHY THE KEY IS `artifactRole -> to`. A retry re-runs the SAME check: the
 * same artifact role, moving to the same state. Pairing on the key is what
 * says "this later success answered that earlier failure". Pairing on time
 * alone would pair a failure with any later success, including one for a
 * different transition.
 */

import type { ObservabilityEvent } from './observability-service.js';

/** The state a QA verdict is issued at. */
export const VERDICT_STATE = 'verdict-issued';

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
 * The state of one transition key AT THE PASS MOMENT.
 *
 * WHY THE STATE IS NOT ONE THING. "The check was unsatisfied" covers two
 * materially different situations, and a reader has to be able to tell them
 * apart:
 *
 *   - `refused` — the check WAS run at the pass moment and said no. The gate
 *     was live, it fired, and the slice passed anyway.
 *   - `unattempted` — the check had NOT been run at the pass moment at all.
 *     The role that owns the check had not yet attempted its transition.
 *
 * On this repository's recorded history one of the twelve findings is
 * `refused` and eleven are `unattempted` — and the second is the more alarming
 * of the two, because it means the pass was declared before the owning role
 * had even tried. Calling all twelve "refusing" would send a reader hunting
 * for a gate that was firing when it was not.
 */
export type UnsatisfiedKeyState = 'refused' | 'unattempted';

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

/**
 * The `verdict-issued` attempt of a slice whose prereq verdict this build
 * cannot READ, or null when there is none.
 *
 * WHY THIS IS NOT "NO VERDICT". The event schema keeps `detail` loose, so a
 * record CAN carry a `prereqOk` that is not a boolean — the string `"true"`,
 * a number, a null. The two cases are different facts: a record with no
 * `prereqOk` at all is the verdict-LESS arrival event, while a record with a
 * `prereqOk` this build cannot read is a verdict that was RECORDED and is
 * UNREADABLE. Reading the second as the first makes the slice vanish: it has
 * no pass moment, so it is in neither the numerator nor the denominator, and
 * no coverage count mentions it.
 *
 * THE SCOPE IS THE VERDICT TRANSITION, because that is the attempt that
 * decides whether the slice passed at all. A malformed verdict on another
 * transition does not make the slice's pass unreadable.
 *
 * `beforeIndex` bounds the search to the attempts that come BEFORE the pass
 * moment: the reference moment is the FIRST successful `verdict-issued`
 * attempt, so an unreadable attempt after it cannot have decided the pass.
 */
export function unreadableVerdictOf(
  events: readonly ObservabilityEvent[],
  beforeIndex?: number
): UnreadableVerdict | null {
  for (const [index, event] of events.entries()) {
    if (beforeIndex !== undefined && index >= beforeIndex) return null;
    if (event.category !== 'slice-transition') continue;
    const detail = event.detail as { to?: unknown; prereqOk?: unknown };
    if (detail.to !== VERDICT_STATE) continue;
    if (!('prereqOk' in detail)) continue;
    if (typeof detail.prereqOk === 'boolean') continue;
    return {
      key: attemptKey(event) ?? `-> ${VERDICT_STATE}`,
      sessionId: event.sessionId,
      ts: event.ts,
      value: describePrereqValue(detail.prereqOk)
    };
  }
  return null;
}

/** A prereq verdict the record carries in a shape this build cannot read. */
export type UnreadableVerdict = {
  /** The transition key: `artifactRole -> to`. */
  readonly key: string;
  readonly sessionId: string;
  readonly ts: string;
  /** The value the record carried, spelled out so a reader can see it. */
  readonly value: string;
};

/**
 * How a prereq verdict that is not a boolean is described to a reader.
 *
 * The value is named, not summarised: a reader who is told "the verdict was
 * unreadable" has to open the record to learn what it actually said, and
 * `"true"` read as a boolean is exactly the reading this build must not make.
 */
function describePrereqValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return `the string "${value}"`;
  if (typeof value === 'number') return `the number ${String(value)}`;
  if (typeof value === 'boolean') return `the boolean ${String(value)}`;
  return `a ${typeof value}`;
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
 * The moment the slice was declared PASSING.
 *
 * The pass moment is the first `verdict-issued` attempt whose prereq check
 * SUCCEEDED. A `verdict-issued` attempt whose check failed is a refused
 * transition, not a pass, so it does not end the wait — the slice was still
 * trying when it refused.
 *
 * The POSITION is returned alongside the timestamp because two events can
 * share a millisecond, and the comparison this moment is used for — "was
 * this key satisfied by then?" — is a question about order, which a
 * timestamp cannot answer when the clock does not advance.
 */
export function passMomentOf(
  attempts: readonly PrereqAttempt[]
): { readonly index: number; readonly ts: string } | null {
  const pass = attempts.find(
    (attempt) => attempt.key.endsWith(`-> ${VERDICT_STATE}`) && attempt.passed
  );
  return pass === undefined ? null : { index: pass.index, ts: pass.ts };
}

/**
 * The keys whose check was STILL UNSATISFIED when the slice was declared
 * passing, each with its state at that moment.
 *
 * A key qualifies when it recorded at least one failed attempt AND had no
 * successful attempt at or before the pass moment. The absence of a success
 * is what shows it was still unsatisfied when the slice passed.
 *
 * THE STATE AT THE PASS MOMENT IS NOT ONE THING, and the difference is the
 * finding:
 *
 *   - `refused` — the check had run at the pass moment and said no. The gate
 *     was live, it fired, and the slice passed anyway.
 *   - `unattempted` — the check had NOT run at the pass moment. The owning
 *     role had not yet attempted its transition, and the slice was declared
 *     passing without it.
 *
 * On this repository's recorded history one of the twelve findings is
 * `refused` and eleven are `unattempted`. Calling all twelve "refusing"
 * would send a reader after a gate that was firing when it was not.
 *
 * The failure is not required to PRECEDE the pass moment: a key whose only
 * failure came after the pass is still a key that was unsatisfied when the
 * slice was declared passing, and that is the finding.
 */
export function unsatisfiedKeys(
  attempts: readonly PrereqAttempt[],
  passIndex: number
): readonly {
  readonly key: string;
  readonly state: UnsatisfiedKeyState;
  readonly refusalCount: number;
}[] {
  const keys: {
    readonly key: string;
    readonly state: UnsatisfiedKeyState;
    readonly refusalCount: number;
  }[] = [];
  const byKey = new Map<string, PrereqAttempt[]>();
  for (const attempt of attempts) {
    const bucket = byKey.get(attempt.key);
    if (bucket === undefined) byKey.set(attempt.key, [attempt]);
    else bucket.push(attempt);
  }
  for (const [key, bucket] of byKey) {
    const refusals = bucket.filter((attempt) => !attempt.passed);
    if (refusals.length === 0) continue;
    const satisfiedByPass = bucket.some((attempt) => attempt.passed && attempt.index <= passIndex);
    if (satisfiedByPass) continue;
    // The state is read at the PASS MOMENT, not over the whole history: a
    // check that refused only AFTER the pass had not run at all by then.
    const refusedAtPass = refusals.some((attempt) => attempt.index <= passIndex);
    keys.push({
      key,
      state: refusedAtPass ? 'refused' : 'unattempted',
      refusalCount: refusals.length
    });
  }
  return keys;
}

/** The failed attempts of one unsatisfied key — the evidence for the finding. */
export function failuresOf(
  attempts: readonly PrereqAttempt[],
  key: string
): readonly PrereqAttempt[] {
  return attempts.filter((attempt) => attempt.key === key && !attempt.passed);
}
