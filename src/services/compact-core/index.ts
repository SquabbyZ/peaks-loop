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

// Phase 2 Task 2.1 — capsule types + canonical SHA-256 digest.
export type {
  ConvergenceCapsule,
  ApprovedGoal,
  JobCursor,
  RequestCursor,
  GateReceipt,
  TaskSnapshot,
  DecisionRecord,
  OpenQuestion,
  FailureRecord,
  ArtifactPointer,
  NextAction,
  IdempotencyEnvelope,
  ConvergenceCapsuleInput,
  ConvergenceCapsuleSchema,
  WorkflowMode
} from './capsule-types.js';
export { deriveCapsuleId } from './capsule-types.js';
export { CircularCapsuleError, canonicalize, digestCapsule, verifyCapsuleDigest } from './capsule-digest.js';

// Phase 2 Task 2.2 — bounded deterministic reduction.
export { CapsuleBudgetExceededError, canonicalBodyBytes, reduceCapsule } from './capsule-reducer.js';

// Phase 2 Task 2.3 — canonical progress semantics (design §8).
export {
  COMPACT_STAGE_WEIGHTS,
  CompactProgressTracker,
  verifyResumeCompletion
} from './progress-protocol.js';
export type {
  CompactProgressSnapshot,
  CompactTerminal,
  ResumeCompletionResult
} from './progress-protocol.js';

// Phase 2 Task 2.5 — mock host bridge + fallback coordinator (design §4.4,
// §6.1, §9, §10.2, §10.3).
export {
  FALLBACK_PROBE_FAILED,
  FALLBACK_REDUCE_FAILED,
  FALLBACK_REPLACE_FAILED,
  FALLBACK_RESUME_FAILED,
  FallbackProbeError,
  FallbackReductionError,
  FallbackReplaceError,
  FallbackResumeError,
  createFallbackCapsule,
  createFallbackCapsuleSeam,
  defaultFallbackEvents,
  makeMockHostBridge,
  runFallbackCompaction,
  strongDefaultProfile
} from './fallback-coordinator.js';
export type {
  CreateFallbackCapsuleInput,
  CreateFallbackCapsuleSeamGetters,
  FallbackCoordinationInput,
  FallbackCoordinationResult,
  FallbackFailureCode,
  FallbackStage,
  MakeMockHostBridgeOptions,
  MockAttemptsLedger,
  MockHostBridgeAttachment,
  MockScript
} from './fallback-coordinator.js';

// Phase 2 Task 2.6 — journal-driven recovery (design §10.5).
export {
  DEFAULT_MAX_AGE_MS,
  decideRecoveryAction,
  resumeAttemptFromJournal
} from './recovery.js';
export type {
  DecideRecoveryActionInput,
  FallbackCoordinatorDispatch,
  RecoveryAbandonCode,
  RecoveryDecision,
  ResumeAttemptFromJournalInput,
  ResumeAttemptFromJournalResult
} from './recovery.js';

// Phase 3 Task 3.1 — provider manifest schema re-exports. Imported from
// a separate module so the manifest loader can validate before any host
// bridge is constructed.
export {
  PROVIDER_MANIFEST_SCHEMA_VERSION,
  DEFAULT_MANIFEST_TTL_MS,
  CompactProviderManifestSchema,
  computeManifestDigest,
  validateManifestFreshness,
  assertNoForbiddenManifestContent
} from '../compact-providers/provider-manifest-schema.js';
export type {
  CompactProviderManifest,
  CompactProviderManifestEntry
} from '../compact-providers/provider-manifest-schema.js';
export {
  ManifestParseError,
  ManifestDigestMismatchError,
  ManifestExpiredError,
  ManifestClockSkewError,
  ManifestSuspiciousTtlError,
  ManifestInvalidTimestampError,
  ManifestForbiddenContentError
} from '../compact-providers/provider-manifest-schema.js';
export type {
  HostSessionDescriptor,
  CompactProviderMetadata,
  CompactCapabilityProvider,
  CompactProviderCertification,
  LoadedProvider
} from '../compact-providers/compact-capability-provider.js';
