/**
 * Task 1.1 — compact protocol identity contract.
 *
 * The protocol layer only defines vendor-neutral types plus tiny pure
 * helpers that assert the cross-cutting identity invariants from design
 * §4.4–§4.5, §8.1 and §9.1:
 *   - every bridge request, receipt and CompactEvent carries `attemptId`
 *     and `pathGeneration`;
 *   - mutating requests additionally carry `capabilityEpoch`.
 * These helpers are the single source of truth the coordinator (later
 * slices) uses to reject malformed envelopes.
 */
import { describe, expect, it } from 'vitest';
import {
  MUTATING_REQUEST_KINDS,
  assertEventIdentity,
  assertReceiptIdentity,
  assertRequestIdentity,
  hasAttemptIdentity,
  isMutatingRequestKind
} from '../../../../src/services/compact-core/index.js';
import type {
  CapsuleReplacementRequest,
  CompactEvent,
  NativeCompactRequest,
  ResumeReceipt
} from '../../../../src/services/compact-core/index.js';

const nativeRequest: NativeCompactRequest = {
  kind: 'native-compact',
  sessionId: 'sess-1',
  attemptId: 'attempt-1',
  pathGeneration: 0,
  capabilityEpoch: 'epoch-1',
  targetRatio: 0.6
};

const capsuleRequest: CapsuleReplacementRequest = {
  kind: 'capsule-replacement',
  sessionId: 'sess-1',
  attemptId: 'attempt-1',
  pathGeneration: 1,
  capabilityEpoch: 'epoch-1',
  capsuleDigest: 'sha256:abc',
  rollbackRequired: true
};

const resumeReceipt: ResumeReceipt = {
  attemptId: 'attempt-1',
  pathGeneration: 1,
  continuationTokenDigest: 'sha256:def',
  sameUi: true,
  resumedAt: '2026-07-23T00:00:00.000Z'
};

const startedEvent: CompactEvent = {
  type: 'started',
  attemptId: 'attempt-1',
  pathGeneration: 0,
  path: 'native'
};

describe('attempt/generation identity is carried everywhere', () => {
  it('requests carry attemptId and pathGeneration', () => {
    expect(hasAttemptIdentity(nativeRequest)).toBe(true);
    expect(hasAttemptIdentity(capsuleRequest)).toBe(true);
  });

  it('receipts carry attemptId and pathGeneration', () => {
    expect(hasAttemptIdentity(resumeReceipt)).toBe(true);
  });

  it('every event variant carries attemptId and pathGeneration', () => {
    const events: readonly CompactEvent[] = [
      startedEvent,
      { type: 'stage', attemptId: 'a', pathGeneration: 0, stage: 'preparing', label: 'Preparing' },
      { type: 'progress', attemptId: 'a', pathGeneration: 0, completed: 1, total: 6, unit: 'work' },
      { type: 'detail', attemptId: 'a', pathGeneration: 0, message: 'x' },
      {
        type: 'completed',
        attemptId: 'a',
        pathGeneration: 0,
        receipt: {
          attemptId: 'a',
          pathGeneration: 0,
          path: 'native',
          sameUi: true,
          before: { ratio: 0.9, source: 'exact', measuredAt: '2026-07-23T00:00:00.000Z' },
          after: { ratio: 0.4, source: 'exact', measuredAt: '2026-07-23T00:00:01.000Z' },
          completionSource: 'host-event',
          continuationToken: 'tok',
          completedAt: '2026-07-23T00:00:02.000Z'
        }
      },
      { type: 'failed', attemptId: 'a', pathGeneration: 0, code: 'COMPACT_TIMEOUT', recoverable: true }
    ];
    for (const event of events) {
      expect(hasAttemptIdentity(event)).toBe(true);
      expect(() => assertEventIdentity(event)).not.toThrow();
    }
  });

  it('assertRequestIdentity / assertReceiptIdentity accept well-formed envelopes', () => {
    expect(() => assertRequestIdentity(nativeRequest)).not.toThrow();
    expect(() => assertRequestIdentity(capsuleRequest)).not.toThrow();
    expect(() => assertReceiptIdentity(resumeReceipt)).not.toThrow();
  });
});

describe('mutating requests additionally carry capabilityEpoch', () => {
  it('classifies native-compact and capsule-replacement as mutating', () => {
    expect(isMutatingRequestKind('native-compact')).toBe(true);
    expect(isMutatingRequestKind('capsule-replacement')).toBe(true);
    expect(isMutatingRequestKind('resume')).toBe(true);
    expect(isMutatingRequestKind('probe')).toBe(false);
    expect(isMutatingRequestKind('measure-context')).toBe(false);
    expect([...MUTATING_REQUEST_KINDS]).toContain('native-compact');
  });

  it('rejects a mutating request missing capabilityEpoch', () => {
    const broken = { ...nativeRequest, capabilityEpoch: '' };
    expect(() => assertRequestIdentity(broken)).toThrow(/capabilityEpoch/);
  });

  it('rejects a request missing attemptId', () => {
    const broken = { ...nativeRequest, attemptId: '' };
    expect(() => assertRequestIdentity(broken)).toThrow(/attemptId/);
  });

  it('rejects a request with a negative pathGeneration', () => {
    const broken = { ...nativeRequest, pathGeneration: -1 };
    expect(() => assertRequestIdentity(broken)).toThrow(/pathGeneration/);
  });

  it('rejects an event missing attempt identity', () => {
    const broken = { type: 'detail', attemptId: '', pathGeneration: 0, message: 'x' } as CompactEvent;
    expect(() => assertEventIdentity(broken)).toThrow(/attemptId/);
  });
});
