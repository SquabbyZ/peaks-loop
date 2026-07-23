import {
  VERIFICATION_CIRCUIT_TRIP_THRESHOLD,
  type AttemptStore,
  type CompactSessionCircuitState
} from './attempt-store.js';

export const AUTO_COMPACT_VERIFICATION_CIRCUIT_OPEN =
  'AUTO_COMPACT_VERIFICATION_CIRCUIT_OPEN' as const;

export type CircuitDecision =
  | { readonly kind: 'continue'; readonly failureCount: 1 | 2 }
  | {
      readonly kind: 'open';
      readonly failureCount: 3;
      readonly code: typeof AUTO_COMPACT_VERIFICATION_CIRCUIT_OPEN;
    }
  | { readonly kind: 'already-open'; readonly failureCount: number };

export async function recordVerificationFailure(
  store: AttemptStore,
  input: {
    readonly sessionId: string;
    readonly attemptId: string;
    readonly failureCode: string;
    readonly now: Date;
  }
): Promise<CircuitDecision> {
  assertValidDate(input.now);
  const current = await store.readSessionCircuit();
  assertSession(current, input.sessionId);
  if (current.circuit !== 'closed') {
    return {
      kind: 'already-open',
      failureCount: current.consecutiveVerificationFailures
    };
  }

  const next = await store.recordVerificationFailure(input.attemptId, input.failureCode);
  if (next.consecutiveVerificationFailures >= VERIFICATION_CIRCUIT_TRIP_THRESHOLD) {
    return {
      kind: 'open',
      failureCount: 3,
      code: AUTO_COMPACT_VERIFICATION_CIRCUIT_OPEN
    };
  }
  return {
    kind: 'continue',
    failureCount: next.consecutiveVerificationFailures as 1 | 2
  };
}

export async function markManualCompactObserved(
  store: AttemptStore,
  input: { readonly sessionId: string; readonly now: Date }
): Promise<CompactSessionCircuitState> {
  assertValidDate(input.now);
  const current = await store.readSessionCircuit();
  assertSession(current, input.sessionId);
  if (current.circuit === 'closed') {
    throw new Error('manual compact observation requires an open verification circuit');
  }
  return store.writeSessionCircuit({
    ...current,
    circuit: 'awaiting-manual-observation'
  });
}

export async function closeCircuitAfterVerifiedManualCompact(
  store: AttemptStore,
  input: {
    readonly sessionId: string;
    readonly verificationPassed: boolean;
    readonly now: Date;
  }
): Promise<CompactSessionCircuitState> {
  assertValidDate(input.now);
  const current = await store.readSessionCircuit();
  assertSession(current, input.sessionId);
  if (current.circuit !== 'awaiting-manual-observation') {
    throw new Error('verified manual compact requires an awaited manual observation');
  }
  if (!input.verificationPassed) {
    return store.writeSessionCircuit({ ...current, circuit: 'open' });
  }
  return store.writeSessionCircuit({
    ...current,
    consecutiveVerificationFailures: 0,
    circuit: 'closed',
    openedAt: null,
    lastFailureCode: null
  });
}

function assertSession(state: CompactSessionCircuitState, sessionId: string): void {
  if (state.sessionId !== sessionId) {
    throw new Error('sessionId must match the attempt store session');
  }
}

function assertValidDate(now: Date): void {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error('now must be a valid Date');
  }
}
