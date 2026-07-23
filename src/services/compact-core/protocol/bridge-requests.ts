/**
 * Bridge request envelopes and the cross-cutting attempt-identity
 * contract (design §4.4–§4.5).
 *
 * Every request carries `attemptId` and `pathGeneration` so the
 * coordinator can correlate an in-flight compact attempt across path
 * switches. Mutating requests (those that change host session state)
 * additionally carry `capabilityEpoch`, letting the host reject a stale
 * bridge whose capabilities changed after the attempt began.
 *
 * Note: the design sketch shows `probe`/`measureContext` inputs without a
 * `pathGeneration`. This slice strengthens the contract so *every*
 * request carries the full attempt identity, per the Task 1.1 constraint
 * that every request/event/receipt carry `attemptId` and `pathGeneration`.
 */

/** Minimal identity every request, receipt and event must carry. */
export interface AttemptIdentity {
  readonly attemptId: string;
  readonly pathGeneration: number;
}

/**
 * True when `value` carries a non-empty `attemptId` and a non-negative
 * integer `pathGeneration`. Pure structural check with no throwing.
 */
export function hasAttemptIdentity(value: unknown): value is AttemptIdentity {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { attemptId?: unknown; pathGeneration?: unknown };
  return (
    typeof candidate.attemptId === 'string' &&
    candidate.attemptId.length > 0 &&
    typeof candidate.pathGeneration === 'number' &&
    Number.isInteger(candidate.pathGeneration) &&
    candidate.pathGeneration >= 0
  );
}

/** Discriminant for every bridge request. */
export type BridgeRequestKind =
  | 'probe'
  | 'native-compact'
  | 'capsule-replacement'
  | 'measure-context'
  | 'resume'
  | 'inspect-transaction'
  | 'rollback';

/**
 * Request kinds that change host session state. These must additionally
 * carry a non-empty `capabilityEpoch`.
 */
export const MUTATING_REQUEST_KINDS: readonly BridgeRequestKind[] = [
  'native-compact',
  'capsule-replacement',
  'resume',
  'rollback'
] as const;

/** True when `kind` denotes a state-mutating request. */
export function isMutatingRequestKind(kind: BridgeRequestKind): boolean {
  return (MUTATING_REQUEST_KINDS as readonly string[]).includes(kind);
}

/** Read-only capability probe. */
export interface ProbeRequest extends AttemptIdentity {
  readonly kind: 'probe';
  readonly sessionId: string;
}

/** Invoke the host's native compact and observe it. Mutating. */
export interface NativeCompactRequest extends AttemptIdentity {
  readonly kind: 'native-compact';
  readonly sessionId: string;
  readonly capabilityEpoch: string;
  readonly targetRatio: number;
}

/** Replace context in place with a Peaks capsule. Mutating. */
export interface CapsuleReplacementRequest extends AttemptIdentity {
  readonly kind: 'capsule-replacement';
  readonly sessionId: string;
  readonly capabilityEpoch: string;
  readonly capsuleDigest: string;
  readonly rollbackRequired: true;
}

/** Read-only current-context measurement. */
export interface MeasureContextRequest extends AttemptIdentity {
  readonly kind: 'measure-context';
  readonly sessionId: string;
}

/** Resume the current task in the same UI after a verified compact. Mutating. */
export interface ResumeRequest extends AttemptIdentity {
  readonly kind: 'resume';
  readonly sessionId: string;
  readonly capabilityEpoch: string;
  readonly continuationToken: string;
}

/** Read-only inspection of an in-flight replacement transaction. */
export interface InspectTransactionRequest extends AttemptIdentity {
  readonly kind: 'inspect-transaction';
  readonly sessionId: string;
}

/** Roll back a failed in-place replacement. Mutating. */
export interface RollbackRequest extends AttemptIdentity {
  readonly kind: 'rollback';
  readonly sessionId: string;
  readonly capabilityEpoch: string;
}

/** Any bridge request. */
export type BridgeRequest =
  | ProbeRequest
  | NativeCompactRequest
  | CapsuleReplacementRequest
  | MeasureContextRequest
  | ResumeRequest
  | InspectTransactionRequest
  | RollbackRequest;

/**
 * Assert that `request` carries full attempt identity, and — when it is a
 * mutating kind — a non-empty `capabilityEpoch`. Throws a descriptive
 * error otherwise. This is the single validation point later stages call
 * before dispatching a request.
 */
export function assertRequestIdentity(request: BridgeRequest): void {
  if (typeof request.attemptId !== 'string' || request.attemptId.length === 0) {
    throw new Error(`bridge request "${request.kind}" is missing attemptId`);
  }
  if (
    typeof request.pathGeneration !== 'number' ||
    !Number.isInteger(request.pathGeneration) ||
    request.pathGeneration < 0
  ) {
    throw new Error(`bridge request "${request.kind}" has an invalid pathGeneration`);
  }
  if (isMutatingRequestKind(request.kind)) {
    const epoch = (request as { capabilityEpoch?: unknown }).capabilityEpoch;
    if (typeof epoch !== 'string' || epoch.length === 0) {
      throw new Error(`mutating bridge request "${request.kind}" is missing capabilityEpoch`);
    }
  }
}
