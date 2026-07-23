/**
 * Bridge receipts and context measurement (design §4.5, §9.1).
 *
 * Receipts also carry `attemptId` and `pathGeneration` so completion and
 * resume can be correlated to the exact attempt/path-generation that
 * produced them. `assertReceiptIdentity` is the validation point the
 * coordinator uses before trusting a receipt.
 */

/** A single point-in-time context usage measurement. */
export interface ContextMeasurementReading {
  readonly ratio: number;
  readonly source: string;
  readonly measuredAt: string;
}

/** Receipt returned by a resume: proves same-UI continuation happened. */
export interface ResumeReceipt {
  readonly attemptId: string;
  readonly pathGeneration: number;
  readonly continuationTokenDigest: string;
  readonly sameUi: true;
  readonly resumedAt: string;
}

/**
 * Receipt proving a compact completed with verifiable before/after
 * measurements in the same UI.
 */
export interface CompactCompletionReceipt {
  readonly attemptId: string;
  readonly pathGeneration: number;
  readonly path: 'native' | 'fallback';
  readonly sameUi: true;
  readonly before: ContextMeasurementReading;
  readonly after: ContextMeasurementReading;
  readonly completionSource: 'host-event' | 'remeasure';
  readonly continuationToken: string;
  readonly completedAt: string;
}

/** State of an in-flight in-place replacement transaction. */
export interface TransactionReceipt {
  readonly attemptId: string;
  readonly pathGeneration: number;
  readonly state: 'pending' | 'committed' | 'rolled-back' | 'unknown';
}

/** Any receipt carrying attempt identity. */
export type BridgeReceipt = ResumeReceipt | CompactCompletionReceipt | TransactionReceipt;

/**
 * Assert that `receipt` carries a non-empty `attemptId` and a valid
 * `pathGeneration`. Throws a descriptive error otherwise.
 */
export function assertReceiptIdentity(receipt: BridgeReceipt): void {
  if (typeof receipt.attemptId !== 'string' || receipt.attemptId.length === 0) {
    throw new Error('bridge receipt is missing attemptId');
  }
  if (!Number.isInteger(receipt.pathGeneration) || receipt.pathGeneration < 0) {
    throw new Error('bridge receipt has an invalid pathGeneration');
  }
}
