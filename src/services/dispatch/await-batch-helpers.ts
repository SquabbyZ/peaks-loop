/**
 * Slice `strict-remediation-abc` (C wave 1, leaf `c1w1-await-batch`) — the
 * per-slot half of `./await-batch.ts`, moved VERBATIM so that `awaitBatch`
 * stops carrying a 155-line / complexity-40 body (`max-lines-per-function` is
 * severity 2) and that module clears the 300 raw-line cap.
 *
 * What lives here: the slot table (one mutable entry per dispatch index), the
 * one-tick observation pass, the no-progress watchdog predicate, the poll sleep
 * and the per-dispatch result / note rendering. What stayed in
 * `./await-batch.ts`: the public types, the options and budget resolution, the
 * batch-outcome rules, the fail-fast de-escalation and the poll loop itself.
 *
 * No body here was rewritten. The predicates, the branch order, the `??`
 * fallbacks, the `now()` call sites and the `readOutcome` / `readRecord` call
 * counts are exactly the ones `awaitBatch` had before the move, because this is
 * the READER side of the sub-agent dispatch-record contract and its behaviour
 * is pinned from the outside by
 * `tests/unit/services/dispatch/sub-agent-dispatchers.test.ts` (the
 * stale-to-timeout mapping, the per-IDE note shapes, corrupt record → timeout)
 * and by `tests/unit/cli/commands/sub-agent-await-commands.test.ts` (the CLI
 * envelope over real record files).
 */
import { existsSync, readFileSync } from 'node:fs';

/**
 * Read a dispatch record's `status` and `outcome` off disk. Missing or
 * unreadable (including unparseable JSON) reads as `{ null, null }`, which is
 * what keeps a corrupt record a timeout rather than a thrown error.
 */
export function defaultReadOutcome(recordPath: string): {
  status: string | null;
  outcome: string | null;
} {
  if (!recordPath) return { status: null, outcome: null };
  try {
    if (!existsSync(recordPath)) return { status: null, outcome: null };
    const raw = readFileSync(recordPath, 'utf8');
    const obj = JSON.parse(raw) as { status?: unknown; outcome?: unknown };
    const status = typeof obj.status === 'string' ? obj.status : null;
    const outcome = typeof obj.outcome === 'string' ? obj.outcome : null;
    return { status, outcome };
  } catch {
    return { status: null, outcome: null };
  }
}

/** One slot's mutable state — the value type of `awaitBatch`'s slot map. */
export interface AwaitBatchSlot {
  recordPath: string;
  status: 'done' | 'failed' | 'cancelled' | 'timeout';
  note: string | null;
  finishedAt: number | null;
  lastProgress: number;
}

/** The slot table plus the batch start time the watchdog and the notes read. */
export interface AwaitBatchSlotTable {
  readonly startedAt: number;
  readonly slots: Map<number, AwaitBatchSlot>;
  readonly lastProgressAt: Map<number, number>;
}

/** One per-dispatch result — the element type of `AwaitBatchResult.results`. */
export interface AwaitBatchSlotResult {
  readonly dispatchIndex: number;
  readonly recordPath: string;
  readonly status: 'done' | 'failed' | 'cancelled' | 'timeout';
  readonly durationMs: number;
  readonly note: string | null;
}

const DEFAULT_POLL_INTERVAL_MS = 50;

/**
 * Seed one slot per record path, all of them `timeout` until a tick proves
 * otherwise, plus the progress map the no-progress watchdog runs off.
 */
export function createSlotTable(
  recordPaths: readonly string[],
  startedAt: number
): AwaitBatchSlotTable {
  const slots = new Map<number, AwaitBatchSlot>();
  for (let i = 0; i < recordPaths.length; i += 1) {
    const recordPath = recordPaths[i] ?? '';
    slots.set(i, {
      recordPath,
      status: 'timeout',
      note: null,
      finishedAt: null,
      lastProgress: 0
    });
  }

  // Track last observed progress per slot to power the no-progress
  // watchdog. The watchdog advances on any per-tick observation
  // change in the slot's progress hint (read from the file's
  // `progress` field when available, else from the `heartbeats`
  // array's last entry).
  const lastProgressAt = new Map<number, number>();
  for (const [idx] of slots) {
    lastProgressAt.set(idx, startedAt);
  }

  return { startedAt, slots, lastProgressAt };
}

/**
 * Map an on-disk status onto the per-dispatch status union, or `null` when the
 * dispatch has not reached a terminal state yet.
 *
 * The default readOutcome returns the on-disk `status`. We map
 * a small set of values to the per-dispatch status union.
 * `outcome` field so the per-IDE note can surface the human
 * reason (e.g. "mock failure at leaf-2"). The `outcome` is read
 * alongside the `status` via `readRecord` and surfaced into
 * `slot.note` for failed dispatches; for done/cancelled the
 * note is left null (matches the pre-nightshift contract).
 * `stale` is mapped to `timeout` so the per-IDE note preserves
 * the human-readable reason (cursor / claude-code both surface
 * `stale` on the wire but the BatchResult.status union only
 * knows `timeout`).
 */
function mapTerminalStatus(
  outcome: string,
  recordOutcome: string | null
): { status: AwaitBatchSlot['status']; note: string | null } | null {
  if (outcome === 'done' || outcome === 'success') {
    return { status: 'done', note: null };
  }
  if (outcome === 'failed') {
    return { status: 'failed', note: recordOutcome ?? null };
  }
  if (outcome === 'cancelled') {
    return { status: 'cancelled', note: null };
  }
  if (outcome === 'stale') {
    return { status: 'timeout', note: 'stale' };
  }
  // Any other status (queued / running / finalizing /
  // never-started / unreadable) means the dispatch has not
  // reached a terminal state yet.
  return null;
}

/**
 * One observation pass over the pending slots. Returns the `allDone` the loop
 * branched on: `true` only when every slot reached a terminal state.
 */
export function pollSlotsOnce(
  table: AwaitBatchSlotTable,
  readOutcome: (recordPath: string) => string | null,
  readRecord: (recordPath: string) => { status: string | null; outcome: string | null },
  now: () => number
): boolean {
  let allDone = true;
  for (const [idx, slot] of table.slots) {
    if (slot.finishedAt !== null) continue;
    const outcome = readOutcome(slot.recordPath);
    if (outcome === null) {
      allDone = false;
      continue;
    }
    const terminal = mapTerminalStatus(outcome, readRecord(slot.recordPath).outcome);
    if (terminal === null) {
      allDone = false;
      continue;
    }
    slot.status = terminal.status;
    slot.note = terminal.note;
    slot.finishedAt = now();
    table.lastProgressAt.set(idx, now());
  }
  return allDone;
}

/**
 * No-progress watchdog: every slot has been without observable
 * progress for `noProgressBudget`, and there is at least one slot.
 */
export function hasNoProgress(
  table: AwaitBatchSlotTable,
  now: () => number,
  noProgressBudget: number
): boolean {
  const allStalled = Array.from(table.slots.entries()).every(
    ([idx, slot]) =>
      slot.finishedAt !== null ||
      now() - (table.lastProgressAt.get(idx) ?? table.startedAt) >= noProgressBudget
  );
  return allStalled && table.slots.size > 0;
}

/** Sleep a tick on the resolved scheduler. */
export function sleepTick(schedule: (cb: () => void, ms: number) => void): Promise<void> {
  return new Promise<void>((resolveSleep) =>
    schedule(() => resolveSleep(), DEFAULT_POLL_INTERVAL_MS)
  );
}

/**
 * The per-IDE note for one slot.
 *
 * rewritten to match the 1.4 dogfood contract:
 *   - claude-code (no notePrefix): note = slot.note (the raw
 *     outcome, or null when done/cancelled)
 *   - other IDEs (notePrefix set):
 *       - on timeout:                  `${notePrefix} (timeout)`
 *       - on failed (with outcome):    `${notePrefix} — ${outcome}`
 *       - on failed (no outcome):      `${notePrefix}`
 *       - on done / cancelled:         `${notePrefix}`
 */
function resolveSlotNote(slot: AwaitBatchSlot, baseNote: string | null): string | null {
  let note: string | null;
  if (baseNote === null) {
    // Claude-Code path: surface the raw outcome (no per-IDE prefix).
    note = slot.note;
  } else if (slot.finishedAt === null) {
    // Timed-out slot: keep the legacy ` (timeout)` suffix.
    note = `${baseNote} (timeout)`;
  } else if (slot.status === 'failed' && slot.note !== null && slot.note.length > 0) {
    // Failed with a human reason: `${notePrefix} — ${outcome}`.
    note = `${baseNote} — ${slot.note}`;
  } else if (slot.note !== null && slot.note.length > 0) {
    // Non-failed terminal slot with a non-null note (e.g. cursor /
    // claude-code `stale` → status=timeout, note='stale'):
    // `${notePrefix} — ${note}` so the human reason is surfaced.
    // the slot's note entirely (the bare-prefix else swallowed
    // it). The 1.4 dogfood for `stale` flips the contract.
    note = `${baseNote} — ${slot.note}`;
  } else {
    // Done / cancelled / failed-without-reason: bare prefix.
    note = baseNote;
  }
  return note;
}

/**
 * Build the per-dispatch results in dispatchIndex order.
 */
export function buildBatchResults(
  table: AwaitBatchSlotTable,
  notePrefix: string | undefined,
  effectiveTimeoutMs: number
): readonly AwaitBatchSlotResult[] {
  const baseNote = notePrefix ?? null;
  return Array.from(table.slots.entries())
    .sort(([a], [b]) => a - b)
    .map(([idx, slot]) => {
      const finishedAt = slot.finishedAt ?? table.startedAt + effectiveTimeoutMs;
      return {
        dispatchIndex: idx,
        recordPath: slot.recordPath,
        status: slot.status,
        durationMs: finishedAt - table.startedAt,
        note: resolveSlotNote(slot, baseNote)
      };
    });
}
