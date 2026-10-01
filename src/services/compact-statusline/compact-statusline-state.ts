// src/services/compact-statusline/compact-statusline-state.ts
//
// Wave-5 class-A hoist (rid 2026-10-01-wave5-w5-3-compact-release): the two
// lifecycle-state readers `stateFromLifecycle` and `stateFromStalled` moved
// VERBATIM out of `compact-statusline-service.ts` (:210-252 at the split)
// for the 300-raw-line cap. They are module-internal helpers of the parent
// decision layer; nothing outside imports them. One-directional imports
// only: this module reads the cell table, the parent reads both.

import type { CompactLifecycleRecord } from './compact-lifecycle-store.js';
import {
  CELL_BY_STAGE,
  type CompactStatuslineState,
  STAGE_CELL_COMPACTING
} from './compact-statusline-cell-table.js';

export function stateFromLifecycle(record: CompactLifecycleRecord): CompactStatuslineState {
  if (record.stage === 'failed') {
    const failedAt = record.failedAt ?? 'compacting';
    const state: CompactStatuslineState = {
      kind: 'failed',
      filledCells: CELL_BY_STAGE.get(failedAt) ?? STAGE_CELL_COMPACTING,
      triggerRatio: record.triggerRatio,
      redLine: record.redLine,
      failedAt
    };
    if (record.errorSummary !== undefined) {
      return { ...state, detail: record.errorSummary };
    }
    return state;
  }
  const filledCells = CELL_BY_STAGE.get(record.stage) ?? 0;
  const base: CompactStatuslineState = {
    kind: record.stage,
    filledCells,
    triggerRatio: record.triggerRatio,
    redLine: record.redLine
  };
  if (record.stage === 'completed' && typeof record.afterRatio === 'number') {
    return { ...base, afterRatio: record.afterRatio };
  }
  return base;
}

export function stateFromStalled(record: CompactLifecycleRecord): CompactStatuslineState {
  const filledCells = CELL_BY_STAGE.get(record.stage) ?? STAGE_CELL_COMPACTING;
  const detailText =
    record.stage === 'failed' ? record.errorSummary : `no heartbeat for ${record.stage} stage`;
  const state: CompactStatuslineState = {
    kind: 'stalled',
    filledCells,
    triggerRatio: record.triggerRatio,
    redLine: record.redLine
  };
  if (detailText !== undefined) {
    return { ...state, detail: detailText };
  }
  return state;
}
