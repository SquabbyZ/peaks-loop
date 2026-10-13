/**
 * The active-dispatches ledger reaper: the bound that stops the index growing
 * with the session, and the decision about which rows it may act on.
 *
 * Split out of `./active-dispatch-index.ts` (that module owns the index FORMAT —
 * register, unregister, read; this one owns the POLICY). Why a reaper exists at
 * all: nothing ever finalized a dispatch. Measured 2026-10-12 across four
 * sessions, `queued`/total was 39/39, 2/2, 9/9, 23/23 — not one record in any
 * session had been finalized, and a recovery verb built for the purpose
 * (`peaks sub-agent finalize --all-stale`) did not help, because building a verb
 * does not make anyone call it. So the bound is applied by the tooling, at the
 * one moment the index can grow: the next dispatch write.
 */
import { assertSafeDispatchRecordPath } from '../security/safe-settings-path.js';
import {
  readActiveDispatchIndex,
  unregisterActiveDispatch,
  type ActiveDispatchEntry
} from './active-dispatch-index.js';

const MINUTES_PER_HOUR = 60;
const MS_PER_MINUTE = 60_000;

/** The bound, in hours. Named so the constant below states a policy, not a `6`. */
const LEDGER_REAP_BOUND_HOURS = 6;

/**
 * How long a row may sit in the index still `queued` before the next dispatch
 * write reaps it.
 *
 * Six hours, from the ledger's own data rather than a round number: the ACTIVE
 * session's index spans 8.6 hours and holds 18 entries, all `queued`; the
 * largest gap between two dispatches in it is 4h19m. The bound must clear the
 * longest dispatch a session can legitimately still be running, and 6h is above
 * every dispatch interval this ledger records while staying two orders of
 * magnitude tighter than the 30-day `DISPATCH_RECORD_TTL_DAYS` file GC.
 *
 * Only a row whose RECORD is still `queued` is reaped. The residual risk is
 * recorded rather than hidden: a sub-agent still running when the session
 * dispatches again after a longer-than-six-hour gap has its bookkeeping cleared
 * early. Its work is unaffected; its later finalize call finds nothing `queued`
 * and reports that.
 *
 * One thing the reap inherits rather than causes, recorded because it is
 * invisible otherwise: `markCompleted` also attempts a graph `envelope-received`
 * transition, and the reaped records are graph-bound. That transition is inert —
 * measured 2026-10-13, 54/54 nodes in `.peaks/_runtime/<sessionId>/graphs/` are
 * still `prepared` — so the reap changes no graph state. Documented, not fixed.
 */
export const LEDGER_REAP_BOUND_MS = LEDGER_REAP_BOUND_HOURS * MINUTES_PER_HOUR * MS_PER_MINUTE;

export interface ReapStaleQueuedEntriesInput {
  projectRoot: string;
  sessionId: string;
  /**
   * The RECORD's own status — the source of truth — or `null` when the record
   * file is absent. Injected rather than read here so this module does not
   * import the writer that imports it.
   *
   * Why the record and not the index row: no production path ever writes a
   * mid-flight status into a row. `registerActiveDispatch` hardcodes `queued`,
   * and the only unregister caller is `markCompleted`, whose terminal statuses
   * DELETE the row. So every row reads `queued` — measured 20/20 rows of the
   * active session — and a guard that read the row would reap a sub-agent that
   * is heartbeating right now. `no-execution` is terminal for the heartbeat
   * pollers, so that would stop a watcher waiting on live work.
   */
  readStatus: (recordPath: string) => string | null;
  /**
   * Terminal transition for the on-disk record (`markCompleted` in
   * `./dispatch-record-writer.ts`, injected to keep this module free of a
   * cycle back into the writer). It is expected to unregister the row as a
   * side effect, which is what removes it from the index.
   */
  finalize: (recordPath: string) => void;
  /** Test seam; defaults to the real clock. */
  now?: () => Date;
  /** Override {@link LEDGER_REAP_BOUND_MS}; the CLI never does. */
  boundMs?: number;
}

/** What the reaper did, so the caller (and a test) can see it rather than infer it. */
export interface ReapStaleQueuedEntriesResult {
  /**
   * Rows removed from the index. A row is removed when its record was
   * finalized, and also when the row named no usable record — a path outside
   * `.peaks/_sub_agents/`, or one whose file is absent. Both leave the index
   * smaller; only the first changes a record.
   */
  readonly reaped: readonly string[];
}

/**
 * Sentinel for a row that names nothing this module may act on: a path outside
 * the ledger (the guard refuses it) or a record file that is absent. Distinct
 * from `unreadable`, which is a real status meaning "a record I may not
 * rewrite" — the two must not be collapsed, because the first is a row to drop
 * and the second is a row to keep.
 */
const UNUSABLE_ROW = 'unusable-row';

/**
 * The record's status. The path guard runs HERE, before the record is read,
 * because the row names a path this function goes on to write to; a refused
 * path returns {@link UNUSABLE_ROW} rather than a status, so a refused row is
 * never read and never mistaken for a readable one.
 */
function readStatusGuarded(input: ReapStaleQueuedEntriesInput, recordPath: string): string {
  try {
    assertSafeDispatchRecordPath(recordPath, input.projectRoot);
  } catch {
    return UNUSABLE_ROW;
  }
  return input.readStatus(recordPath) ?? UNUSABLE_ROW;
}

/** What the reaper may do with one row. */
type RowDecision = 'reap' | 'drop' | 'keep';

/** Decide one row, from the row and the record it names. */
function decideRow(
  input: ReapStaleQueuedEntriesInput,
  recordPath: string,
  entry: ActiveDispatchEntry,
  cutoffMs: number
): RowDecision {
  if (entry.status !== 'queued') return 'keep';
  const createdAtMs = Date.parse(entry.createdAt);
  if (!Number.isFinite(createdAtMs) || createdAtMs >= cutoffMs) return 'keep';
  const recordStatus = readStatusGuarded(input, recordPath);
  if (recordStatus === 'queued') return 'reap';
  if (recordStatus === UNUSABLE_ROW) return 'drop';
  return 'keep';
}

/** Remove a row from the index without touching the record it named. */
function dropRow(input: ReapStaleQueuedEntriesInput, recordPath: string): void {
  unregisterActiveDispatch({
    projectRoot: input.projectRoot,
    sessionId: input.sessionId,
    recordPath,
    status: 'no-execution'
  });
}

/**
 * Finalize every index row whose RECORD is still `queued` past the bound, and
 * drop it from the index. Called at the start of `writeInitialDispatchRecord`,
 * i.e. at the next dispatch write — the exact moment the index would grow.
 *
 * A row is dropped without finalizing when it names no usable record: a path
 * outside `.peaks/_sub_agents/`, or a file that is absent. A row pointing at no
 * record is stale by definition.
 *
 * The row is only a hint. The RECORD decides: `running` / `finalizing` is a live
 * dispatch and is left alone however old it is, and a record the writer already
 * terminated is left to that writer. Only a record still `queued` — never
 * started AND never finalized — is reaped. (This is the distinction that
 * matters: `no-execution` is terminal for the heartbeat pollers, so reaping a
 * live record would stop a watcher waiting on it.)
 */
export function reapStaleQueuedEntries(
  input: ReapStaleQueuedEntriesInput
): ReapStaleQueuedEntriesResult {
  const now = input.now ?? (() => new Date());
  const boundMs = input.boundMs ?? LEDGER_REAP_BOUND_MS;
  const cutoffMs = now().getTime() - boundMs;
  const index = readActiveDispatchIndex(input.projectRoot, input.sessionId);
  const reaped: string[] = [];
  for (const [recordPath, entry] of Object.entries(index)) {
    const decision = decideRow(input, recordPath, entry, cutoffMs);
    if (decision === 'keep') continue;
    reaped.push(recordPath);
    if (decision === 'drop') {
      dropRow(input, recordPath);
      continue;
    }
    try {
      input.finalize(recordPath);
    } catch {
      // The reader said `queued` and the writer could not turn it terminal;
      // drop the row so it cannot accumulate.
      dropRow(input, recordPath);
    }
  }
  return { reaped };
}
