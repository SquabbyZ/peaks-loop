// src/services/batch/batch-entry.ts
//
// The batch-mode entry decision: how many independent items make a batch.
//
// WHY THIS DECISION IS ITS OWN MODULE. Batch mode is an ADDITION to the
// race lane, never a substitute for it. The lane's single-task path is
// unchanged by a batch, and the only thing that decides whether a request
// takes it is how many independent items the user handed over. So the
// decision is isolated here: one function, one boundary, and every caller
// asks the same question the same way.
//
// THE BOUNDARY IS TWO, NOT ONE. One item is not a batch. The batch
// machinery — the parallel read-only diagnosis fan-out, the rule pre-read,
// the topology step — all exist to amortize setup across several
// independent items. Applied to one item they cost what they save and
// change the single-task lane's behaviour, which is the one thing the
// batch mode is forbidden from doing. So one item reads "single" and
// takes exactly the path it takes today.
//
// WHY THE COUNT IS NOT THE ONLY INPUT. This function counts ITEMS, and the
// caller is the one that has already established that the items are
// mutually independent. A batch of items that share a file is still a
// batch here: the topology step (see `batch-diagnosis.ts`) is what decides
// that two of them may not run at the same time, and folding that
// judgement in here would make the entry decision depend on the topology
// the entry decision exists to gate.

/**
 * Whether a batch of independent items engages the batch machinery.
 *
 * `single` means: take today's path — no diagnosis fan-out, no rule
 * pre-read, no topology step. `batch` means: the batch machinery may
 * engage.
 */
export type BatchMode = 'single' | 'batch';

/**
 * The number of items at which the batch machinery engages.
 *
 * Two, because one item is the single-task lane's own case and the batch
 * exists for the case where setup is amortized over more than one.
 */
export const BATCH_MODE_MIN_ITEMS = 2;

/**
 * Decide which path a batch of independent items takes.
 *
 * @param itemCount - How many independent items the user handed over.
 * @returns `single` for zero or one item, `batch` for two or more.
 */
export function decideBatchMode(itemCount: number): BatchMode {
  return itemCount >= BATCH_MODE_MIN_ITEMS ? 'batch' : 'single';
}
