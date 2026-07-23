/**
 * Task 1.3 persistent circuit policy tests.
 *
 * Dimensions: behavior and integration. Render and a11y do not apply because
 * this module returns typed control decisions without user-facing output.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  closeCircuitAfterVerifiedManualCompact,
  markManualCompactObserved,
  recordVerificationFailure
} from '../../../../src/services/compact-core/circuit-breaker.js';
import { createAttemptStore } from '../../../../src/services/compact-core/attempt-store.js';

const SESSION = 'session-1';
let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-circuit-policy-'));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('behavior — three-strike decisions', () => {
  it('continues bounded recovery after failures one and two, opens on three, and does no work on four', async () => {
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });

    await expect(recordVerificationFailure(store, failure('attempt-1'))).resolves.toEqual({ kind: 'continue', failureCount: 1 });
    await expect(recordVerificationFailure(store, failure('attempt-1'))).resolves.toEqual({ kind: 'continue', failureCount: 2 });
    await expect(recordVerificationFailure(store, failure('attempt-1'))).resolves.toEqual({
      kind: 'open',
      failureCount: 3,
      code: 'AUTO_COMPACT_VERIFICATION_CIRCUIT_OPEN'
    });
    await expect(recordVerificationFailure(store, failure('attempt-1'))).resolves.toEqual({
      kind: 'already-open',
      failureCount: 3
    });
    expect((await store.readSessionCircuit()).consecutiveVerificationFailures).toBe(3);
  });

  it('rejects a mismatched session instead of mutating another session store', async () => {
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });
    await expect(recordVerificationFailure(store, { ...failure('attempt-1'), sessionId: 'other' })).rejects.toThrow(/sessionId/);
  });
});

describe('integration — persistence and verified manual recovery', () => {
  it('survives a new attempt ID and process restart', async () => {
    const first = createAttemptStore({ projectRoot, sessionId: SESSION });
    await recordVerificationFailure(first, failure('attempt-1'));
    await recordVerificationFailure(first, failure('attempt-1'));
    await recordVerificationFailure(first, failure('attempt-1'));

    const restarted = createAttemptStore({ projectRoot, sessionId: SESSION });
    await expect(recordVerificationFailure(restarted, failure('attempt-2'))).resolves.toEqual({
      kind: 'already-open',
      failureCount: 3
    });
  });

  it('manual signal alone advances to awaiting observation but does not clear', async () => {
    const store = await openCircuit();
    await markManualCompactObserved(store, { sessionId: SESSION, now: new Date('2026-07-23T01:00:00Z') });
    const state = await store.readSessionCircuit();
    expect(state).toMatchObject({
      circuit: 'awaiting-manual-observation',
      consecutiveVerificationFailures: 3
    });
  });

  it('a verified manual pass closes and resets the circuit', async () => {
    const store = await openCircuit();
    await markManualCompactObserved(store, { sessionId: SESSION, now: new Date('2026-07-23T01:00:00Z') });
    await expect(
      closeCircuitAfterVerifiedManualCompact(store, {
        sessionId: SESSION,
        verificationPassed: true,
        now: new Date('2026-07-23T01:01:00Z')
      })
    ).resolves.toMatchObject({ circuit: 'closed', consecutiveVerificationFailures: 0 });
  });

  it('a failed manual verification stays blocked and does not reset', async () => {
    const store = await openCircuit();
    await markManualCompactObserved(store, { sessionId: SESSION, now: new Date('2026-07-23T01:00:00Z') });
    await expect(
      closeCircuitAfterVerifiedManualCompact(store, {
        sessionId: SESSION,
        verificationPassed: false,
        now: new Date('2026-07-23T01:01:00Z')
      })
    ).resolves.toMatchObject({ circuit: 'open', consecutiveVerificationFailures: 3 });
  });
});

describe('integration — caller-supplied timestamps are persisted deterministically', () => {
  it('records openedAt using the caller-supplied now (no wall-clock jitter)', async () => {
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });
    const declared = new Date('2026-07-23T03:30:00.000Z');
    await recordVerificationFailure(store, failure('attempt-1', declared));
    await recordVerificationFailure(store, failure('attempt-1', declared));
    await recordVerificationFailure(store, failure('attempt-1', declared));
    const state = await store.readSessionCircuit();
    expect(state.openedAt).toBe('2026-07-23T03:30:00.000Z');
  });

  it('records manual observation transitions at caller-supplied time', async () => {
    const store = await openCircuit();
    const declared = new Date('2026-07-23T04:00:00.000Z');
    await markManualCompactObserved(store, { sessionId: SESSION, now: declared });
    const state = await store.readSessionCircuit();
    expect(state.circuit).toBe('awaiting-manual-observation');
  });
});

describe('integration — corrupted circuit count is fail-closed', () => {
  it('rejects persisted state whose count is past threshold instead of restoring the literal 3', async () => {
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });
    await recordVerificationFailure(store, failure('attempt-1'));
    await recordVerificationFailure(store, failure('attempt-1'));
    await recordVerificationFailure(store, failure('attempt-1'));
    const tampered = JSON.stringify({
      ...(await store.readSessionCircuit()),
      consecutiveVerificationFailures: 4
    });
    const circuitPath = join(
      projectRoot,
      '.peaks',
      '_runtime',
      SESSION,
      'compact-attempts',
      'session-circuit.json'
    );
    mkdirSync(join(projectRoot, '.peaks', '_runtime', SESSION, 'compact-attempts'), {
      recursive: true
    });
    writeFileSync(circuitPath, `${tampered}\n`, 'utf8');
    const restarted = createAttemptStore({ projectRoot, sessionId: SESSION });
    await expect(restarted.readSessionCircuit()).rejects.toThrow(
      /consecutiveVerificationFailures/
    );
    // Policy returns literal 3 only when the store accepts the state.
    await expect(recordVerificationFailure(restarted, failure('attempt-2'))).rejects.toThrow(
      /consecutiveVerificationFailures/
    );
  });
});

describe('integration — concurrency is delegated to the coordinator (synchronous-after-read)', () => {
  it('records decisions that the caller invokes in order even on the same store', async () => {
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });
    const t0 = new Date('2026-07-23T05:00:00.000Z');
    const r1 = await recordVerificationFailure(store, failure('attempt-1', t0));
    const r2 = await recordVerificationFailure(store, failure('attempt-1', t0));
    const r3 = await recordVerificationFailure(store, failure('attempt-1', t0));
    expect([r1.failureCount, r2.failureCount, r3.failureCount]).toEqual([1, 2, 3]);
    expect(r3.kind).toBe('open');
  });
});

function failure(attemptId: string, now: Date = new Date('2026-07-23T00:00:00Z')) {
  return {
    sessionId: SESSION,
    attemptId,
    failureCode: 'CONTEXT_NOT_REDUCED',
    now
  } as const;
}

async function openCircuit() {
  const store = createAttemptStore({ projectRoot, sessionId: SESSION });
  await recordVerificationFailure(store, failure('attempt-1'));
  await recordVerificationFailure(store, failure('attempt-1'));
  await recordVerificationFailure(store, failure('attempt-1'));
  return store;
}
