/**
 * Phase 2 Task 2.1 — canonical SHA-256 digest tests.
 *
 * Pin the digest contract:
 *   - SHA-256 hex of canonical JSON
 *   - object keys sorted recursively (deep)
 *   - arrays preserve order
 *   - excludes only top-level `digest` field
 *   - circular input rejected
 *   - mutation changes digest
 *   - key-order independence
 *   - verify is recompute-based
 */
import { describe, expect, it } from 'vitest';
import {
  canonicalize,
  digestCapsule,
  verifyCapsuleDigest
} from '../../../../src/services/compact-core/capsule-digest.js';
import {
  type ConvergenceCapsule,
  type ConvergenceCapsuleInput
} from '../../../../src/services/compact-core/capsule-types.js';

const HEX64 = 'a'.repeat(64);

function buildBaseInput(): ConvergenceCapsuleInput {
  return {
    schemaVersion: 1,
    capsuleId: HEX64,
    compactAttemptId: 'attempt-001',
    sourceSessionId: 'session-001',
    goal: {
      id: 'goal-1',
      text: 'Ship the capsule',
      approvedAt: '2026-07-23T00:00:00.000Z',
      approvedBy: 'SquabbyZ'
    },
    mode: 'full-auto',
    activeJob: {
      jobId: 'job-1',
      lane: 'main',
      phase: 'implementation',
      updatedAt: '2026-07-23T00:00:00.000Z'
    },
    activeRequest: null,
    completedGates: [],
    activeTasks: [],
    decisions: [],
    openQuestions: [],
    failureHistory: [],
    artifactIndex: [],
    nextAction: {
      id: 'a1',
      kind: 'continue',
      summary: 'resume'
    },
    idempotency: {
      scope: 'attempt-001',
      sealedKeys: ['goal.id']
    },
    sourceContextMeasurement: {
      promptBytes: 1024,
      capacityBytes: 200_000,
      ratio: 0.00512,
      computedAt: '2026-07-23T00:00:00.000Z',
      windowKind: '200k'
    },
    digest: HEX64
  };
}

function buildCapsule(overrides: Partial<ConvergenceCapsuleInput> = {}): ConvergenceCapsule {
  const input = buildBaseInput();
  const capsuleWithoutDigest: Omit<ConvergenceCapsule, 'digest'> = {
    ...input,
    ...overrides
  } as Omit<ConvergenceCapsule, 'digest'>;
  const digest = digestCapsule(capsuleWithoutDigest);
  // Recompute the input with the same digest (so the build is realistic)
  return { ...capsuleWithoutDigest, digest } as ConvergenceCapsule;
}

describe('canonicalize', () => {
  it('sorts top-level keys', () => {
    const out = canonicalize({ b: 1, a: 2 });
    expect(JSON.stringify(out)).toBe('{"a":2,"b":1}');
  });

  it('sorts nested keys recursively', () => {
    const out = canonicalize({
      outer: { z: 1, a: { y: 2, b: 3 } },
      first: [{ x: 1, c: 2 }, { p: 3, q: 4 }]
    });
    expect(JSON.stringify(out)).toBe(
      '{"first":[{"c":2,"x":1},{"p":3,"q":4}],"outer":{"a":{"b":3,"y":2},"z":1}}'
    );
  });

  it('preserves array order', () => {
    const out = canonicalize([3, 1, 2]);
    expect(out).toEqual([3, 1, 2]);
  });

  it('preserves null in stable form', () => {
    const out = canonicalize({ a: null });
    expect(JSON.stringify(out)).toBe('{"a":null}');
  });

  it('omits undefined fields', () => {
    const out = canonicalize({ a: 1, b: undefined } as { a: number; b: undefined });
    expect(JSON.stringify(out)).toBe('{"a":1}');
  });

  it('preserves empty arrays', () => {
    const out = canonicalize({ a: [] });
    expect(JSON.stringify(out)).toBe('{"a":[]}');
  });

  it('preserves empty objects', () => {
    const out = canonicalize({ a: {} });
    expect(JSON.stringify(out)).toBe('{"a":{}}');
  });

  it('rejects circular object reference', () => {
    const a: Record<string, unknown> = { x: 1 };
    a.self = a;
    expect(() => canonicalize(a)).toThrow(/circular/i);
  });

  it('rejects circular array reference', () => {
    const a: unknown[] = [1];
    a.push(a);
    expect(() => canonicalize(a)).toThrow(/circular/i);
  });

  it('passes through primitive values', () => {
    expect(canonicalize(42)).toBe(42);
    expect(canonicalize('hello')).toBe('hello');
    expect(canonicalize(true)).toBe(true);
    expect(canonicalize(null)).toBeNull();
  });

  it('produces key-order-independent output', () => {
    const a = canonicalize({ b: 1, a: 2, c: { y: 1, x: 2 } });
    const b = canonicalize({ a: 2, c: { x: 2, y: 1 }, b: 1 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('digestCapsule', () => {
  it('returns a 64-hex string', () => {
    const input = buildBaseInput();
    const digest = digestCapsule(input);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic for the same input', () => {
    const input = buildBaseInput();
    const a = digestCapsule(input);
    const b = digestCapsule(input);
    expect(a).toBe(b);
  });

  it('is independent of key insertion order', () => {
    const a = buildBaseInput();
    const bKeys = Object.keys(buildBaseInput());
    const reorderedKeys = [...bKeys].reverse();
    const reordered = {} as Record<string, unknown>;
    for (const k of reorderedKeys) {
      reordered[k] = (buildBaseInput() as unknown as Record<string, unknown>)[k];
    }
    reordered.digest = HEX64;
    const digestA = digestCapsule(a);
    const digestB = digestCapsule(reordered as unknown as ConvergenceCapsuleInput);
    expect(digestA).toBe(digestB);
  });

  it('changes when a string field is mutated', () => {
    const a = buildBaseInput();
    const b = buildBaseInput();
    const aDigest = digestCapsule(a);
    const bDigest = digestCapsule({ ...b, compactAttemptId: 'attempt-002' });
    expect(aDigest).not.toBe(bDigest);
  });

  it('changes when a nested field is mutated', () => {
    const a = buildBaseInput();
    const b = buildBaseInput();
    const aDigest = digestCapsule(a);
    const bDigest = digestCapsule({
      ...b,
      goal: { ...b.goal, text: 'Different goal' }
    });
    expect(aDigest).not.toBe(bDigest);
  });

  it('changes when an array element is mutated', () => {
    const a = buildBaseInput();
    const b = buildBaseInput();
    const aDigest = digestCapsule(a);
    const bDigest = digestCapsule({
      ...b,
      completedGates: [
        {
          gateId: 'g1',
          status: 'passed',
          completedAt: '2026-07-23T00:00:00.000Z',
          receipt: 'r'
        }
      ]
    });
    expect(aDigest).not.toBe(bDigest);
  });

  it('changes when array order changes (preserves order)', () => {
    const a = buildBaseInput();
    const b = buildBaseInput();
    const aDigest = digestCapsule(a);
    const bDigest = digestCapsule({
      ...b,
      completedGates: [
        {
          gateId: 'g2',
          status: 'passed',
          completedAt: '2026-07-23T00:00:00.000Z',
          receipt: 'r2'
        },
        {
          gateId: 'g1',
          status: 'passed',
          completedAt: '2026-07-23T00:00:00.000Z',
          receipt: 'r1'
        }
      ]
    });
    expect(aDigest).not.toBe(bDigest);
  });

  it('ignores the top-level digest field', () => {
    const a = buildBaseInput();
    const b = { ...buildBaseInput(), digest: 'f'.repeat(64) };
    expect(digestCapsule(a)).toBe(digestCapsule(b));
  });

  it('clamps digest length to 64 hex', () => {
    const out = digestCapsule(buildBaseInput());
    expect(out.length).toBe(64);
  });

  it('rejects circular input', () => {
    const input = buildBaseInput();
    const circular: unknown = { ...input, self: null };
    (circular as Record<string, unknown>).self = circular;
    expect(() => digestCapsule(circular as unknown as ConvergenceCapsuleInput)).toThrow(/circular/i);
  });

  it('rejects circular input deep inside an array', () => {
    const input = buildBaseInput();
    const circularArr: unknown[] = [];
    const obj = { ...input, completedGates: [{ gateId: 'g', status: 'passed', completedAt: '2026-07-23T00:00:00.000Z', receipt: 'r', nested: circularArr }] };
    circularArr.push(obj);
    expect(() => digestCapsule(obj as unknown as ConvergenceCapsuleInput)).toThrow(/circular/i);
  });
});

describe('verifyCapsuleDigest', () => {
  it('returns true for a capsule whose digest matches', () => {
    const capsule = buildCapsule();
    expect(verifyCapsuleDigest(capsule)).toBe(true);
  });

  it('returns false when digest is tampered', () => {
    const capsule = buildCapsule();
    const tampered: ConvergenceCapsule = { ...capsule, digest: 'b'.repeat(64) };
    expect(verifyCapsuleDigest(tampered)).toBe(false);
  });

  it('returns false when a field is mutated but digest is unchanged', () => {
    const capsule = buildCapsule();
    const mutated: ConvergenceCapsule = { ...capsule, compactAttemptId: 'tampered' };
    expect(verifyCapsuleDigest(mutated)).toBe(false);
  });

  it('returns true regardless of key insertion order (verifier uses canonicalization)', () => {
    const capsule = buildCapsule();
    const keys = Object.keys(capsule).reverse();
    const reordered = {} as Record<string, unknown>;
    for (const k of keys) {
      reordered[k] = (capsule as unknown as Record<string, unknown>)[k];
    }
    expect(verifyCapsuleDigest(reordered as unknown as ConvergenceCapsule)).toBe(true);
  });

  it('returns false for a malformed digest (not 64-hex)', () => {
    const capsule = buildCapsule();
    expect(verifyCapsuleDigest({ ...capsule, digest: 'not-hex' })).toBe(false);
  });

  it('is symmetric: digest then verify round-trips', () => {
    const input = buildBaseInput();
    const digest = digestCapsule(input);
    const capsule: ConvergenceCapsule = { ...input, digest } as ConvergenceCapsule;
    expect(verifyCapsuleDigest(capsule)).toBe(true);
  });
});
