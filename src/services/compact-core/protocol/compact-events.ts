/**
 * Unified compact progress events (design §8.1).
 *
 * Every event carries `attemptId` and `pathGeneration` so a host progress
 * surface and the coordinator can attribute each event to the exact
 * attempt/path-generation. The core never emits ANSI/TUI output; it emits
 * these semantic events and the host bridge maps them to a progress
 * surface (design §8.3).
 */
import type { CompactCompletionReceipt } from './bridge-receipts.js';

/** Fixed, ordered compact stages (design §8.1). */
export type CompactStage =
  | 'preparing'
  | 'checkpointing'
  | 'summarizing'
  | 'replacing'
  | 'verifying'
  | 'resuming';

/** Ordered stage weights are the responsibility of later slices; the
 * canonical stage order is exported for progress monotonicity checks. */
export const COMPACT_STAGES: readonly CompactStage[] = [
  'preparing',
  'checkpointing',
  'summarizing',
  'replacing',
  'verifying',
  'resuming'
] as const;

interface EventBase {
  readonly attemptId: string;
  readonly pathGeneration: number;
}

export interface StartedEvent extends EventBase {
  readonly type: 'started';
  readonly path: 'native' | 'fallback';
}

export interface StageEvent extends EventBase {
  readonly type: 'stage';
  readonly stage: CompactStage;
  readonly label: string;
}

export interface ProgressEvent extends EventBase {
  readonly type: 'progress';
  readonly completed: number;
  readonly total: number;
  readonly unit: 'work';
}

export interface DetailEvent extends EventBase {
  readonly type: 'detail';
  readonly message: string;
}

export interface CompletedEvent extends EventBase {
  readonly type: 'completed';
  readonly receipt: CompactCompletionReceipt;
}

export interface FailedEvent extends EventBase {
  readonly type: 'failed';
  readonly code: string;
  readonly recoverable: boolean;
}

/** The unified compact event stream. */
export type CompactEvent =
  | StartedEvent
  | StageEvent
  | ProgressEvent
  | DetailEvent
  | CompletedEvent
  | FailedEvent;

/**
 * Assert that `event` carries a non-empty `attemptId` and a valid
 * `pathGeneration`. Throws a descriptive error otherwise.
 */
export function assertEventIdentity(event: CompactEvent): void {
  if (typeof event.attemptId !== 'string' || event.attemptId.length === 0) {
    throw new Error(`compact event "${event.type}" is missing attemptId`);
  }
  if (!Number.isInteger(event.pathGeneration) || event.pathGeneration < 0) {
    throw new Error(`compact event "${event.type}" has an invalid pathGeneration`);
  }
}
