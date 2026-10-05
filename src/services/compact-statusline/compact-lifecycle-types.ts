// src/services/compact-statusline/compact-lifecycle-types.ts
//
// The record shape for the runtime compact-lifecycle store
// (`compact-lifecycle-store.ts`), split out to keep the store under the
// 300-raw-line file cap. Types only — no behaviour lives here. The store
// re-exports every name below, so importers keep using
// `compact-lifecycle-store.js` unchanged.

export type CompactLifecycleStage =
  | 'queued'
  | 'preparing'
  | 'compacting'
  /**
   * REGISTERED but no compaction has started — e.g. claude-code's
   * `ide-native` pathway only installs the PreToolUse hook, which
   * compacts in-band at ratio ≥ 0.95. In the 0.80–0.95 band nothing
   * is in flight, so claiming `compacting` was a false heartbeat.
   */
  | 'armed'
  | 'verifying'
  | 'completed'
  | 'failed';

export interface CompactLifecycleRecord {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly stage: CompactLifecycleStage;
  readonly updatedAt: string;
  readonly triggerRatio: number;
  readonly afterRatio?: number;
  readonly redLine: boolean;
  readonly failedAt?: Exclude<CompactLifecycleStage, 'failed' | 'completed'>;
  readonly errorSummary?: string;
}

export type CompactLifecycleRead =
  | { readonly kind: 'missing' }
  | { readonly kind: 'valid'; readonly record: CompactLifecycleRecord }
  | { readonly kind: 'invalid'; readonly reason: string }
  | { readonly kind: 'stalled'; readonly record: CompactLifecycleRecord };
