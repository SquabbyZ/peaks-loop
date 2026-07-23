/**
 * compact-core public surface (Task 1.1).
 *
 * Vendor-neutral compact control-plane protocol + admission policy. This
 * barrel is the only import path consumers use; the internal file layout
 * may change without breaking callers.
 *
 * Red line: nothing under `src/services/compact-core/**` may name a host,
 * a binary, a slash command, or branch on a vendor discriminator
 * (design §2.3). Enforced by
 * `tests/unit/services/compact-core/vendor-neutrality.test.ts`.
 */

// Capability contract.
export type {
  CapabilityProfile,
  ContextMeasurement,
  NativeCompactCapability,
  ContextReplacement,
  ProgressSurface,
  Continuation,
  CompletionSignal,
  RollbackSupport
} from './protocol/capability-profile.js';

// Attempt journal + session circuit (types surfaced because public
// functions on the verification / circuit policy return them).
export type { CompactSessionCircuitState } from './attempt-store.js';

// Bridge requests + attempt identity.
export {
  MUTATING_REQUEST_KINDS,
  assertRequestIdentity,
  hasAttemptIdentity,
  isMutatingRequestKind
} from './protocol/bridge-requests.js';
export type {
  AttemptIdentity,
  BridgeRequest,
  BridgeRequestKind,
  ProbeRequest,
  NativeCompactRequest,
  CapsuleReplacementRequest,
  MeasureContextRequest,
  ResumeRequest,
  InspectTransactionRequest,
  RollbackRequest
} from './protocol/bridge-requests.js';

// Bridge receipts.
export { assertReceiptIdentity } from './protocol/bridge-receipts.js';
export type {
  BridgeReceipt,
  CompactCompletionReceipt,
  ContextMeasurementReading,
  ResumeReceipt,
  TransactionReceipt
} from './protocol/bridge-receipts.js';

// Compact events.
export { COMPACT_STAGES, assertEventIdentity } from './protocol/compact-events.js';
export type {
  CompactEvent,
  CompactStage,
  StartedEvent,
  StageEvent,
  ProgressEvent,
  DetailEvent,
  CompletedEvent,
  FailedEvent
} from './protocol/compact-events.js';

// Host bridge contract.
export type { HostCompactBridge } from './protocol/host-compact-bridge.js';

// Admission policy.
export {
  AUTO_COMPACT_UNSUPPORTED_STRONG_GUARANTEE,
  decideCompactPath
} from './compact-policy.js';
export type { CompactPathDecision, ProviderCertification } from './compact-policy.js';

// Verification and persistent circuit policy.
export { verifyContextReduction } from './context-verifier.js';
export type { ContextReductionVerification } from './context-verifier.js';
export {
  AUTO_COMPACT_VERIFICATION_CIRCUIT_OPEN,
  closeCircuitAfterVerifiedManualCompact,
  markManualCompactObserved,
  recordVerificationFailure
} from './circuit-breaker.js';
export type { CircuitDecision } from './circuit-breaker.js';

// Attempt coordinator (Task 1.5) — the §6 state-machine brain.
export {
  AUTO_COMPACT_EXHAUSTED,
  createAttemptCoordinator
} from './attempt-coordinator.js';
export type {
  AttemptCoordinator,
  CertifiedBridgeAttachment,
  CompactAutoInput,
  CompactAutoResult,
  CompactCoordinatorDependencies
} from './attempt-coordinator.js';
