/**
 * Phase 2 Task 2.1 — canonical SHA-256 digest for `ConvergenceCapsule`.
 *
 * Canonicalization rules (per design §9.1):
 *   - object keys are sorted recursively (deep)
 *   - arrays preserve their order
 *   - `null` becomes JSON null
 *   - `undefined` is omitted (consistent with JSON.stringify)
 *   - empty arrays / empty objects pass through unchanged
 *   - circular references are rejected (throw)
 *
 * The digest covers every top-level field except `digest`. The capsule
 * is a sealed record: anyone can re-derive the digest from the payload
 * and confirm it equals the `digest` field.
 */
import { createHash } from 'node:crypto';
import { ConvergenceCapsuleSchema, type ConvergenceCapsule } from './capsule-types.js';

/** Canonical error for circular references. */
export class CircularCapsuleError extends Error {
  constructor() {
    super('circular input reference rejected');
    this.name = 'CircularCapsuleError';
  }
}

/**
 * Canonicalize a value for stable hashing. Object keys are sorted
 * alphabetically at every depth; arrays preserve order; primitives
 * pass through. `undefined` keys are dropped (matches JSON.stringify).
 */
export function canonicalize(value: unknown): unknown {
  return canonicalizeImpl(value, new WeakSet<object>());
}

function canonicalizeImpl(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (typeof value !== 'object') return value;
  if (seen.has(value as object)) {
    throw new CircularCapsuleError();
  }
  seen.add(value as object);
  try {
    if (Array.isArray(value)) {
      const out: unknown[] = new Array(value.length);
      for (let i = 0; i < value.length; i++) {
        out[i] = canonicalizeImpl(value[i], seen);
      }
      return out;
    }
    const obj = value as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const out: Record<string, unknown> = {};
    for (const k of sortedKeys) {
      const v = canonicalizeImpl(obj[k], seen);
      if (v !== undefined) {
        out[k] = v;
      }
    }
    return out;
  } finally {
    seen.delete(value as object);
  }
}

/**
 * Build the canonical JSON string for a capsule (excluding `digest`).
 * Uses a replacer that drops the top-level `digest` field on the
 * outermost object only.
 */
function canonicalJsonOf(payload: unknown): string {
  const seen = new WeakSet<object>();
  // Walk the payload, skipping the top-level `digest` if present.
  const clean = stripTopLevelDigest(payload);
  return JSON.stringify(toCanonicalSerialForm(clean, seen));
}

function stripTopLevelDigest(payload: unknown): Record<string, unknown> {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    // Defensive: the schema gates this; if someone passes a non-object
    // we still want a deterministic error path.
    throw new Error('digestCapsule requires a capsule object');
  }
  const obj = payload as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) {
    if (k === 'digest') continue;
    out[k] = obj[k];
  }
  return out;
}

/** Convert to the wire form: sort keys, drop `undefined`, preserve arrays. */
function toCanonicalSerialForm(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (typeof value !== 'object') return value;
  if (seen.has(value as object)) {
    throw new CircularCapsuleError();
  }
  seen.add(value as object);
  try {
    if (Array.isArray(value)) {
      const out: unknown[] = new Array(value.length);
      for (let i = 0; i < value.length; i++) {
        out[i] = toCanonicalSerialForm(value[i], seen);
      }
      return out;
    }
    const obj = value as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const out: Record<string, unknown> = {};
    for (const k of sortedKeys) {
      const v = toCanonicalSerialForm(obj[k], seen);
      if (v !== undefined) {
        out[k] = v;
      }
    }
    return out;
  } finally {
    seen.delete(value as object);
  }
}

/**
 * Compute the SHA-256 hex digest of a capsule payload (excluding the
 * top-level `digest` field). The result is 64 lowercase hex chars.
 *
 * Throws on circular input so callers cannot accidentally seal a
 * capsule that cannot be round-tripped. The schema is exported
 * separately for boundary validation; digestCapsule expects the
 * caller to have already validated at the boundary.
 *
 * Accepts input that may include a stale `digest` field — it is
 * stripped before hashing so callers can pass a round-trip capsule.
 */
export function digestCapsule(input: Omit<ConvergenceCapsule, 'digest'>): string {
  const { digest: _ignored, ...rest } = input as Record<string, unknown>;
  void _ignored;
  const json = canonicalJsonOf(rest);
  return createHash('sha256').update(json).digest('hex');
}

/**
 * Verify a capsule's `digest` field matches the SHA-256 of its other
 * fields. Returns false on invalid schema, malformed digest, or
 * mismatch. Never throws for a digest mismatch, but throws on circular
 * input (the capsule shape is unrecoverable in that case).
 */
export function verifyCapsuleDigest(capsule: ConvergenceCapsule): boolean {
  const parsed = ConvergenceCapsuleSchema.safeParse(capsule);
  if (!parsed.success) return false;
  let computed: string;
  try {
    computed = digestCapsule(parsed.data);
  } catch {
    return false;
  }
  return computed === parsed.data.digest;
}
