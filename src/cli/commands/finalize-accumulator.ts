/**
 * The finalize sweep's counters and the two pure helpers that read them, split
 * out of `finalize-runners.ts` to keep each module under the line cap. The
 * accumulator object replaces the mutable arrays the pre-split action closed
 * over: it is created once and threaded explicitly through every branch.
 */
import { getErrorMessage } from 'peaks-loop-shared/result';

import type { DispatchRecord } from '../../services/dispatch/dispatch-record-writer.js';
import type { FinalizeSelection } from './finalize-selection.js';

interface FinalizedEntry {
  recordPath: string;
  requestId: string;
  status: string;
}

interface SkippedEntry {
  recordPath: string;
  reason: string;
}

interface FailedEntry {
  recordPath: string;
  error: string;
}

/** The sweep's three counters, threaded explicitly instead of closed over. */
export interface FinalizeAccumulator {
  readonly finalized: FinalizedEntry[];
  readonly skipped: SkippedEntry[];
  readonly errors: FailedEntry[];
}

export interface MappedOutcome {
  readonly status: 'done' | 'failed' | 'cancelled';
  readonly outcome: 'success' | 'failed' | 'cancelled';
}

// map outcome -> (status, outcome)
export const OUTCOME_MAP: Record<string, MappedOutcome> = {
  done: { status: 'done', outcome: 'success' },
  failed: { status: 'failed', outcome: 'failed' },
  cancelled: { status: 'cancelled', outcome: 'cancelled' }
};

export function makeAccumulator(): FinalizeAccumulator {
  return { finalized: [], skipped: [], errors: [] };
}
/**
 * N2 — one unreadable record must not abort the sweep.
 *
 * Skipping `active-dispatches.json` and `batch-*.counter.json` by FILENAME
 * removed the two non-record files that happened to be in the directory, but a
 * single stale or foreign `dispatch-*.json` (an old `version`, hand-edited
 * JSON, a truncated write) still made `readRecord` throw from OUTSIDE any
 * try/catch — and the throw escaped to the action's outer handler, so
 * `--request-id` AND `--batch` both died with `FINALIZE_ERROR` and exit 1
 * without touching a single healthy record.
 *
 * A record that cannot be read is now reported in `errors[]` and skipped;
 * every other record is processed as before.
 */
export function tryReadRecord(
  recordPath: string,
  readRecord: (recordPath: string) => DispatchRecord,
  acc: FinalizeAccumulator
): DispatchRecord | null {
  try {
    return readRecord(recordPath);
  } catch (e: unknown) {
    acc.errors.push({ recordPath, error: getErrorMessage(e) });
    return null;
  }
}
export function buildFinalizeHints(
  acc: FinalizeAccumulator,
  selection: FinalizeSelection | null
): string[] {
  const hints: string[] = [];
  if (acc.errors.length > 0) {
    hints.push(
      'Re-run after fixing; unreadable records are listed in errors[] and were skipped, not fatal.'
    );
  } else if (acc.finalized.length === 0 && acc.skipped.length > 0) {
    hints.push(
      "Nothing was finalized: every matching record had already left `queued`. See skipped[] for each record's status."
    );
  } else {
    hints.push('All targeted records transitioned out of queued.');
  }
  if (selection !== null) {
    hints.push(
      `--request-id selection (${selection.rule}): chose ${selection.chosen ?? '(none)'} of ${selection.matched} matching record(s); ${selection.rejected.length} rejected.`
    );
  }
  return hints;
}
