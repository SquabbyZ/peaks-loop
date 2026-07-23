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
