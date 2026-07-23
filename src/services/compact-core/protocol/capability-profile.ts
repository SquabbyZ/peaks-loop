/**
 * Capability profile — the vendor-neutral contract the compact control
 * plane consumes to decide whether a host session can perform a
 * strong-guarantee compact.
 *
 * The profile describes *capabilities*, never a host identity. There is
 * deliberately no `vendor` field: the core reads capability values only
 * (design §2.3, §4.4). A profile is produced by probing the host bridge
 * once per attempt; `capabilityEpoch` lets later stages reject a stale
 * bridge whose capabilities changed mid-attempt.
 */

/** How precisely the host can measure current context usage. */
export type ContextMeasurement = 'exact' | 'estimated' | 'none';

/**
 * Whether the host exposes a native compact operation, and whether its
 * completion is observable. `invoke-only` can start a compact but cannot
 * prove it finished, so it is insufficient for a strong guarantee.
 */
export type NativeCompactCapability = 'invoke-and-observe' | 'invoke-only' | 'none';

/** Whether the host can replace context in place within the current TUI. */
export type ContextReplacement = 'in-place' | 'none';

/** Where compact progress can be rendered. `none` fails strong-guarantee admission. */
export type ProgressSurface = 'native' | 'host-rendered' | 'none';

/** Whether work continues in the same UI, a new UI, or cannot continue. */
export type Continuation = 'same-ui' | 'new-ui' | 'none';

/** How compact completion is signalled to the coordinator. */
export type CompletionSignal = 'event-with-measurement' | 'remeasure' | 'none';

/** Whether an in-place replacement can be rolled back after failure. */
export type RollbackSupport = 'transactional' | 'snapshot-restore' | 'none';

/**
 * Immutable capability contract for a single host session, valid for one
 * `capabilityEpoch`. All fields are capability values; none names a vendor.
 */
export interface CapabilityProfile {
  readonly schemaVersion: 1;
  readonly contextMeasurement: ContextMeasurement;
  readonly nativeCompact: NativeCompactCapability;
  readonly contextReplacement: ContextReplacement;
  readonly progressSurface: ProgressSurface;
  readonly continuation: Continuation;
  readonly completionSignal: CompletionSignal;
  readonly rollbackSupport: RollbackSupport;
  readonly capabilityEpoch: string;
}
