// src/services/batch/batch-recovery.ts
//
// What a resumed batch is allowed to do next, given the record on disk.
//
// WHY THIS IS SEPARATE FROM THE STORE. The store answers "what is on disk";
// this answers "what does that mean for the work that is left". Keeping them
// apart means the recovery rule can be read, and changed, without touching
// the file format — and the rule is the whole point of the record.
//
// THE RULE. An item is diagnosed once. `pending` is the only status that still
// needs a diagnosis; `diagnosed`, `fixed` and `verified` all mean the
// diagnosis is behind us. A batch that resumes after a compaction therefore
// diagnoses exactly the items still marked `pending`, and never re-diagnoses
// an item it already knows the root cause of.
//
// The store's merge is by item id, so this is one filter over one field.

import type { BatchItem, BatchProgress } from './batch-progress-types.js';

/** The items whose diagnosis is still outstanding. */
export function pendingItems(progress: BatchProgress): readonly BatchItem[] {
  return progress.items.filter((item) => item.status === 'pending');
}

/** The items whose diagnosis is already behind us. */
export function diagnosedItems(progress: BatchProgress): readonly BatchItem[] {
  return progress.items.filter((item) => item.status !== 'pending');
}
