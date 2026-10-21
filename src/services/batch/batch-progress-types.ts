// src/services/batch/batch-progress-types.ts
//
// The shape of one batch's progress record, and the vocabulary the batch
// orchestrator drives it with.
//
// WHY A SEPARATE MODULE. The store below touches the filesystem; the
// recovery helpers are pure functions over a record. Keeping the names here
// means the recovery path can be used — and tested — without importing any
// I/O.

/**
 * Where one item of the batch stands.
 *
 * `pending` is the only state that still needs work: an item that has been
 * diagnosed, fixed or verified must never be diagnosed again.
 */
export type BatchItemStatus = 'pending' | 'diagnosed' | 'fixed' | 'verified';

/**
 * Which stage of the four-stage batch pipeline the record is in.
 *
 * `phase` is the only field that says "a batch is in flight": the
 * workflow-graph probe cannot see a diagnosis fan-out, so this record is that
 * signal (see the design's account of the compaction gap).
 */
export type BatchPhase = 'diagnosis' | 'topology' | 'fix' | 'verify' | 'done';

/**
 * One independent bug (or small requirement) inside the batch.
 */
export interface BatchItem {
  readonly id: string;
  readonly label: string;
  /**
   * What the user reported, in the user's words.
   *
   * This is the item's INPUT, not a measurement: the diagnosis prompt is
   * built from it, and the report the diagnostician produces is an answer
   * to it. It is kept on the record so a batch that resumes after a
   * compaction can still ask the question — a record that kept only the
   * label would ask the wrong one.
   */
  readonly symptom?: string;
  readonly status: BatchItemStatus;
  /**
   * The repo-relative paths this item is expected to touch.
   *
   * A consumer compares two sets to decide whether two items may run in the
   * same wave, and that comparison is exact string equality — so the set has
   * to be in one canonical form before it is compared. The store keeps
   * whatever it is handed; `normalizeFileSet` in the store module is the
   * normalizer a caller applies before comparing.
   */
  readonly files: readonly string[];
  /** The risk surface this item was judged to hit, when one was recorded. */
  readonly riskSurface?: number;
  readonly diagnosedAt?: string;
  readonly fixedAt?: string;
}

/**
 * The whole record for one batch.
 */
export interface BatchProgress {
  readonly batchId: string;
  readonly phase: BatchPhase;
  readonly items: readonly BatchItem[];
  /** The wave plan produced by the topology stage, when it exists. */
  readonly topology?: unknown;
  /**
   * The notice the batch recorded when it crossed its last phase
   * boundary.
   *
   * The WORDING belongs to the batch's verification stage
   * (`buildPhaseBoundaryNotice`); this record only carries it. That is
   * what lets a reader with no access to that stage — the presence read,
   * for one — still say what happened at the boundary, without a second
   * module writing a second sentence about the same moment.
   *
   * Optional: a batch that crossed a boundary without recording a notice
   * simply has none, and the reader falls back to the ratio sentence.
   */
  readonly boundaryNotice?: string;
  /**
   * When the record was last written.
   *
   * Optional in the type because the writer stamps it: a caller that does
   * not care about the timestamp need not invent one, and the value on disk
   * is always the writer's, never the caller's.
   */
  readonly updatedAt?: string;
}
