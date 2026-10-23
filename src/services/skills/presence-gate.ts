/**
 * The `gate` field of a presence lease — write-side contract.
 *
 * WHAT THE GATE IS. The status header the LLM is told to display —
 * `Peaks-Loop Skill: <skill> | Peaks-Loop Gate: <gate> | Next: <action>` —
 * has three cells. The middle one was, until this slice, MODEL-INVENTED
 * prose: `SetPresenceLeaseInput.gate` existed, but the lease constructor
 * never expanded it, so the lease carried no gate and the read side had
 * nothing to project. The gate is now persisted and projected, so the
 * middle cell is a machine fact.
 *
 * ENUM OR FREE STRING? Free string with a shape check. The gate values
 * this repository actually uses are enumerated in `KNOWN_PRESENCE_GATES`
 * below, but they are NOT an allow-list:
 *
 *   - `repair-cycle-<N>` is a TEMPLATE — the runtime value carries a
 *     counter (`repair-cycle-1`), so it cannot be closed over a static
 *     enumeration.
 *   - `peaks sop check --gate <gate-id>` addresses a gate id defined at
 *     runtime by an SOP, so SOP-scoped gates are not knowable at build
 *     time either.
 *   - third-party skills are free to pass their own gate token.
 *
 * A closed enumeration would reject those, and the CLI already accepts any
 * `--gate <value>` string today; rejecting unknown values would break
 * working callers for no gain. What IS rejected is a malformed value: a
 * control character (it lands verbatim in the status header) or a value
 * longer than `MAX_PRESENCE_GATE_LENGTH`. An empty / whitespace-only value
 * is DROPPED, not rejected — that is the pre-existing behaviour of the
 * `...(gate ? { gate } : {})` spread and it is kept.
 */

/** Error code for a gate value that cannot be persisted. */
export const PEAKS_GATE_INVALID = 'PEAKS_GATE_INVALID';

/** Longest gate value that may be persisted. */
export const MAX_PRESENCE_GATE_LENGTH = 200;

/** A presence error carrying a typed `code`. */
export type PresenceGateError = Error & { readonly code: string };

/**
 * The gate vocabulary this repository uses today (enumerated 2026-10-24
 * from `skills/**` and `src/**`).
 *
 * NOT an allow-list — see the module header. The list exists so the
 * regression test can assert that every gate value the repository uses is
 * accepted by `normalizePresenceGate`, and so a reader can see the
 * vocabulary without grepping.
 */
export const KNOWN_PRESENCE_GATES: readonly string[] = [
  'startup',
  'qa-validation',
  'swarm-fan-out',
  'swarm-converged',
  'repair-cycle-<N>',
  'review-fan-out-converged'
];

function gateError(message: string): PresenceGateError {
  const err = new Error(message) as PresenceGateError;
  err.name = 'PresenceError';
  (err as { code: string }).code = PEAKS_GATE_INVALID;
  return err;
}

/**
 * The control-character boundaries `hasControlCharacter` tests against.
 *
 * C0 controls occupy code points 0x00-0x1F; DEL (0x7F) is the one control
 * character above them. Named constants so the `no-magic-numbers` rule has
 * nothing left to flag in the comparison.
 */
const C0_CONTROL_MAX = 0x20;
const DEL_CONTROL_CODE = 0x7f;

/** True when the value carries a C0 / DEL control character. */
function hasControlCharacter(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < C0_CONTROL_MAX || code === DEL_CONTROL_CODE) return true;
  }
  return false;
}

/**
 * Normalize a gate value for persistence.
 *
 * Returns `undefined` when there is no gate to persist (absent, or empty
 * after trimming). Throws a `PEAKS_GATE_INVALID` error for a value that
 * must not be written (control characters, over-length).
 */
export function normalizePresenceGate(value: string | undefined | null): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw gateError('gate must be a string');
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > MAX_PRESENCE_GATE_LENGTH) {
    throw gateError(`gate is ${trimmed.length} characters long (max ${MAX_PRESENCE_GATE_LENGTH})`);
  }
  if (hasControlCharacter(trimmed)) {
    throw gateError('gate must not contain control characters');
  }
  return trimmed;
}

/**
 * Project a gate value that was READ back from disk.
 *
 * Tolerant by design: a hand-edited lease file, or a lease written by an
 * older release, must never make the read throw. Anything that is not a
 * non-empty string is reported as "no gate".
 */
export function readPresenceGate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
