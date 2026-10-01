// src/services/compact-statusline/compact-statusline-cell-table.ts
//
// Wave-5 class-A hoist (rid 2026-10-01-wave5-w5-3-compact-release): the
// display-state types, timing windows, and frozen cell-table render
// primitives moved VERBATIM out of `compact-statusline-service.ts` (:51-135
// at the split) for the 300-raw-line cap. The
// `/* eslint-disable no-magic-numbers */ ... /* eslint-enable */` pair is
// relocated WHOLE with the region it suppresses — no chunk arrives here
// without its suppression. The parent re-exports `CompactDisplayKind`,
// `CompactStatuslineState` and `COMPLETED_EXPIRY_MS` so existing import
// paths keep working.

import type { CompactLifecycleStage } from './compact-lifecycle-store.js';

export type CompactDisplayKind =
  | 'none'
  | 'queued'
  | 'preparing'
  | 'compacting'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'stalled'
  | 'invalid'
  | 'armed';

export interface CompactStatuslineState {
  readonly kind: CompactDisplayKind;
  // eslint-disable-next-line no-magic-numbers -- type-position literal union for the cell-table contract
  readonly filledCells: 0 | 2 | 4 | 6 | 8;
  readonly triggerRatio?: number;
  readonly afterRatio?: number;
  readonly redLine?: boolean;
  readonly failedAt?: CompactLifecycleStage;
  readonly detail?: string;
}

/**
 * Concrete first-version stale timeout. Adjustable after real timing
 * evidence from the auto-compact orchestrator (it currently writes a
 * heartbeat on every state transition; 120 s is the longest realistic
 * gap between a heartbeat and an actual stall).
 */
export const DEFAULT_STALE_AFTER_MS = 120_000;

/**
 * 10-second completed-window expiry. The brief (Task 6 design requirement)
 * calls out: once a compact lifecycle reaches `completed`, the primary
 * statusline should surface the success indicator for at most 10 seconds,
 * then fall back to the C1 baseline so the consumer (the IDE) does not
 * keep a green ✓ pinned on the status bar indefinitely. The narrow window
 * is sufficient for the human to see "we just compacted" and long enough
 * to not flap on subsequent reads. Adjustable after real timing feedback.
 */
export const COMPLETED_EXPIRY_MS = 10_000;

/**
 * How recently the last history row must itself have been written for the
 * legacy path to report it as "just compacted". Measured against the row's own
 * `ts` — the fact — rather than the file's mtime, which is only a proxy for it
 * and is also moved by rows that record no compaction (repair R9).
 */
export const LEGACY_JUST_COMPACTED_WINDOW_MS = 30_000;

// PRD-002b slice 2 — extract cell-table magic numbers (4/6/8) into named
// consts so the no-magic-numbers lint rule stops flagging the typed
// literal-union cell-table values. Values match the documented contract.
export const STAGE_CELL_COMPACTING = 4;
export const STAGE_CELL_VERIFYING = 6;
export const STAGE_CELL_COMPLETED = 8;

/* eslint-disable no-magic-numbers -- cell-table contract uses literal-type unions (`0 | 2 | 4 | 6 | 8`); these are type-position discriminators, not runtime values. Magic-number extraction is done at the runtime call sites via STAGE_CELL_* constants above. */
export const CELL_BY_STAGE: ReadonlyMap<CompactLifecycleStage, 0 | 2 | 4 | 6 | 8> = new Map<
  CompactLifecycleStage,
  0 | 2 | 4 | 6 | 8
>([
  ['queued', 0],
  ['preparing', 2],
  ['compacting', STAGE_CELL_COMPACTING],
  ['verifying', STAGE_CELL_VERIFYING],
  ['completed', STAGE_CELL_COMPLETED],
  ['failed', STAGE_CELL_COMPACTING]
  // `armed` is not in the cell table: it renders WITHOUT a bar (see
  // renderCompactStatusline). Lookups therefore miss and fall back to 0.
]);

const FILLED = '█';
const EMPTY = '░';
const BAR_WIDTH = STAGE_CELL_COMPLETED;
export const NO_AFTER_RATIO_HINT = 'after-ratio not recorded';

export function renderBar(filledCells: 0 | 2 | 4 | 6 | 8): string {
  return `[${FILLED.repeat(filledCells)}${EMPTY.repeat(BAR_WIDTH - filledCells)}]`;
}

export function renderLegacyBar(filledCells: 0 | 2 | 4 | 6 | 8): string {
  return renderBar(filledCells);
}
/* eslint-enable no-magic-numbers */
