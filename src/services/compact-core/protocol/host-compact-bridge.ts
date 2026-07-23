/**
 * Host Compact Bridge contract (design §4.4, extended per Task 1.1).
 *
 * The bridge is the host-side execution port. The vendor-neutral core
 * consumes this interface only; a concrete bridge is provided by a
 * certified capability provider (design §12). The core never imports a
 * host SDK, spawns a binary, or branches on a vendor name.
 *
 * Task 1.1 requires the bridge to expose exactly these seven methods:
 * `probe`, `invokeNative`, `replaceWithCapsule`, `measureContext`,
 * `resume`, `inspectTransaction`, and `rollback`.
 */
import type { CapabilityProfile } from './capability-profile.js';
import type {
  CapsuleReplacementRequest,
  InspectTransactionRequest,
  MeasureContextRequest,
  NativeCompactRequest,
  ProbeRequest,
  ResumeRequest,
  RollbackRequest
} from './bridge-requests.js';
import type {
  ContextMeasurementReading,
  ResumeReceipt,
  TransactionReceipt
} from './bridge-receipts.js';
import type { CompactEvent } from './compact-events.js';

/**
 * In-process execution port implemented inside the host session. Every
 * method receives a request carrying attempt identity; mutating methods
 * additionally require `capabilityEpoch` on the request.
 */
export interface HostCompactBridge {
  /** Declare the current session's real capabilities for this attempt. */
  probe(input: ProbeRequest): Promise<CapabilityProfile>;

  /** Invoke the host's native compact and stream lifecycle events. */
  invokeNative(input: NativeCompactRequest): AsyncIterable<CompactEvent>;

  /** Replace context in place with a Peaks capsule and stream events. */
  replaceWithCapsule(input: CapsuleReplacementRequest): AsyncIterable<CompactEvent>;

  /** Measure current context usage. */
  measureContext(input: MeasureContextRequest): Promise<ContextMeasurementReading>;

  /** Resume the current task in the same UI after a verified compact. */
  resume(input: ResumeRequest): Promise<ResumeReceipt>;

  /** Inspect an in-flight replacement transaction (crash recovery). */
  inspectTransaction(input: InspectTransactionRequest): Promise<TransactionReceipt>;

  /** Roll back a failed in-place replacement to the prior context. */
  rollback(input: RollbackRequest): Promise<TransactionReceipt>;
}
