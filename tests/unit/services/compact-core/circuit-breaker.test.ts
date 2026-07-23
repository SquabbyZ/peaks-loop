/**
 * Task 1.3 persistent circuit policy tests.
 *
 * Dimensions: behavior and integration. Render and a11y do not apply because
 * this module returns typed control decisions without user-facing output.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
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

function failure(attemptId: string) {
  return {
    sessionId: SESSION,
    attemptId,
    failureCode: 'CONTEXT_NOT_REDUCED',
    now: new Date('2026-07-23T00:00:00Z')
  } as const;
}

async function openCircuit() {
  const store = createAttemptStore({ projectRoot, sessionId: SESSION });
  await recordVerificationFailure(store, failure('attempt-1'));
  await recordVerificationFailure(store, failure('attempt-1'));
  await recordVerificationFailure(store, failure('attempt-1'));
  return store;
}
