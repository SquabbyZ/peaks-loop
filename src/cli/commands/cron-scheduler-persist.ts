/**
 * The ONE writer of `lastRunAt` in this repo — rid `2026-10-01-cron-last-run-at-01`
 * (backlog §2.24), repair cycle 1 (review F1/F4/F5). Lives in its own file because
 * `cron-commands.ts` sits at 287 of its 300 raw-line cap and
 * `cron-scheduler-commands.ts` is already over its own; the rule below is small
 * enough to be read, tested and quoted from here.
 *
 * WHO CALLS THIS (3 call sites, one rule): the daemon tick
 * (`cron-scheduler-commands.ts:369`), `cron-scheduler run-once` (:304), and
 * `peaks cron run` (`cron-commands-actions.ts:175`). The third site is the repair:
 * at `9badd1ac` `peaks cron run` folded its own snapshot and stamped EVERY record,
 * killed ones included (`cron-commands-actions.ts:174` of that commit, no `killed`
 * test), while this file skipped them. The same killed fire therefore stayed due
 * under the daemon and went silent for a full `intervalMs` under `cron run` — the
 * documented runbook / external-crontab path. There is now one fold, so there is one
 * outcome per fire, whichever command ran it.
 *
 * WHY IT EXISTS (measured, not inferred). Before the slice the daemon tick (the
 * `for (const task of due) { runTask(…); }` body at `9badd1ac`) discarded the
 * `RunRecord`, and `listDueTasks` keeps an entry due whenever `lastRunAt` is
 * null (`cron-commands-schedule.ts:212`, `if (e.lastRunAt === null) return true;`).
 * Measured by `tests/unit/cli/commands/cron-last-run-at.test.ts`: **6 `runTask`
 * invocations across 6 ticks** for one entry with `intervalMs` 86,400,000 at the
 * 60,000 ms daemon period — a 1440× rate error against the declared interval, and the
 * rate half of
 * `.peaks/docs/diagnosis-2026-10-01-worktree-list-population.md` §9. The same
 * test observes **1** once the write-back below runs.
 *
 * THE RULE (persist AFTER the run, from the record's `finishedAt`):
 *   1. a run that reached a conclusion — exit code 0 or non-zero, not killed —
 *      advances `lastRunAt` to `record.finishedAt`, so the entry goes quiet for
 *      exactly its own `intervalMs` and not one ms longer;
 *   2. a run carrying `killed: true` does NOT advance it, in EITHER entry point.
 *      Work cut off mid-flight is not a day's work, so the task stays due and is
 *      retried. What that costs is NOT uniform across platforms, and F3 of the
 *      review is the reason this paragraph is platform-shaped instead of global:
 *      - win32: the only fire shape that reaches `killed: true` here is the exec
 *        timeout (`cron-commands.ts:178-185`, spawnSync's `error.code ===
 *        'ETIMEDOUT'` branch), and that fire BLOCKS its caller for the whole
 *        injected timeout — measured at 3,019 ms and 3,020 ms of block for an injected
 *        3,000 ms timeout (`tests/unit/cli/commands/cron-exec-timeout.test.ts`, whose
 *        positive control brings the same wiring back in 67-71 ms when the child
 *        concludes), and the production value is `EXEC_TIMEOUT_MS = 300_000`
 *        (`cron-commands.ts:74`). The
 *        tick is a synchronous callback on one `setInterval`
 *        (`cron-scheduler-commands.ts:378`), so fires serialize and a permanently
 *        stuck entry costs at most 3,600,000 / 300,000 = **12 fires per hour**, not
 *        one per 60,000 ms tick. A child killed from OUTSIDE does not carry `killed`
 *        on this platform: the review measured a `taskkill /F`-terminated child
 *        returning `status 1` in 419 ms, and the same shape driven through `runTask`
 *        against `dist/` at repair time came back `exitCode 1` with NO `killed` key in
 *        383 ms and 410 ms — which takes the CONCLUDED branch
 *        (`cron-commands.ts:193-199`) and is therefore STAMPED. Both writers now
 *        agree about that class (it is stamped by both), and neither pretends rule 2
 *        can see it on win32.
 *      - POSIX: an external signal death has no status and no timeout error, so it
 *        does hit `cron-commands.ts:200-206` and carry `killed: true`, and `runTask`
 *        returns as soon as the child dies. That class re-fires once per 60,000 ms
 *        tick — the deliberate price of not silencing unfinished work, and the shape
 *        this host cannot produce.
 *      Timestamping at `startedAt` was rejected (goal §alternatives): it would mark a
 *      killed run as done and silence it.
 *   3. every entry the file holds survives the write. Parsed entries are re-written
 *      from a schedule that is RE-READ at write time, so a task an operator added
 *      while the daemon was busy is preserved field-for-field
 *      (`cron-last-run-at.test.ts`, "when an operator adds a task while the daemon is
 *      running one…"); and entries `toScheduleEntry`
 *      (`cron-commands-schedule.ts:129-150`) REJECTS — a hand-edited entry missing
 *      `name`, say — are carried through as the raw JSON they were written as,
 *      appended after the parsed ones. F5 of the review: before this they were
 *      silently DELETED by the daemon's first write, which is data loss on a
 *      long-lived process nobody is watching. An unparseable entry with the same `id`
 *      as a parsed one is the one thing still dropped, because two entries under one
 *      id would make the fold ambiguous.
 *
 * WINDOWS, NAMED (F4 + the lock that does not exist):
 * - Inside this function the read→write sequence has no `await` and no yield point,
 *   so within one process the window is nil; it is cross-process only.
 * - `peaks cron run` used to be the wide window: at `9badd1ac` it read the whole
 *   schedule (`cron-commands-actions.ts:143`), ran each target synchronously for up
 *   to `EXEC_TIMEOUT_MS` (300,000 ms) per task (:172), then rewrote the file from
 *   that PRE-RUN snapshot (:156) — which reverted any stamp the daemon had
 *   landed in between, back to `null`, i.e. permanently due, §2.24 re-opened until
 *   the next concluded run. It calls this function now, so its write is a write-time
 *   re-read like this one's; `cron-last-run-at.test.ts` ("…another writer stamps…")
 *   measures the revert case.
 * - What is still open, stated rather than implied: there is NO lock on
 *   `schedule.json`, and `writeSchedule` is a plain `writeFileSync`
 *   (`cron-commands-schedule.ts:170-174`). Last-writer-wins on the VALUE across two
 *   processes that both land inside this function's own re-read→write tail remains,
 *   and a host failure mid-write still truncates the file. That needs the
 *   locking/atomic-write framework this slice deliberately does not take on.
 * - One write per BATCH, not per record (F6, not fixed here): `runTask` throws for fs
 *   failure inside `appendHistory` (`cron-commands-schedule.ts:176-188` does a
 *   read+write of the whole history per record), so a throw at task k loses the
 *   stamps for tasks 1..k-1 and the tick's catch turns it into one stderr line; those
 *   already-concluded tasks are due again next tick. Reachability is documented at
 *   `skills/peaks-code/references/cron-scheduler-deployment.md:98-101` (a read-only
 *   `.peaks/cron`).
 */

import { existsSync, readFileSync } from 'node:fs';

import {
  readSchedule,
  schedulePath,
  SCHEDULE_VERSION,
  toScheduleEntry,
  writeSchedule,
  type RunRecord,
  type ScheduleEntry
} from './cron-commands-schedule.js';

/**
 * Fold a batch of finished runs into `schedule.json`.
 *
 * `records` is what `runTask` returned for the tasks this batch ran; a record whose
 * task id is no longer in the schedule (an operator removed the entry mid-flight) is
 * dropped rather than resurrected. When nothing is left to change — every run
 * killed, or the whole batch stale — the file is not rewritten.
 */
export function persistLastRunAt(projectRoot: string, records: ReadonlyArray<RunRecord>): void {
  const concludedAt = new Map<string, number>();
  for (const record of records) {
    if (record.killed === true) continue;
    concludedAt.set(record.taskId, record.finishedAt);
  }
  if (concludedAt.size === 0) return;

  const current = readSchedule(projectRoot);
  const entries: Array<ScheduleEntry | Record<string, unknown>> = [];
  let stamped = 0;
  for (const entry of current.entries) {
    const finishedAt = concludedAt.get(entry.id);
    if (finishedAt === undefined) {
      entries.push(entry);
      continue;
    }
    entries.push({ ...entry, lastRunAt: finishedAt });
    stamped += 1;
  }
  if (stamped === 0) return;

  writeSchedule(projectRoot, {
    version: SCHEDULE_VERSION,
    entries: [...entries, ...unrepresentedEntries(projectRoot, current.entries)]
  });
}

/**
 * The raw JSON of every entry on disk that `toScheduleEntry` refused, so this write
 * preserves what it cannot represent (F5) instead of deleting it.
 *
 * Two reads of one file, deliberately: `readSchedule` above is the validating one
 * (it owns the version check and the throw on malformed JSON), and this one is the
 * byte-preserving one. They are not a snapshot of each other — a file clobbered
 * between them throws here and the write does not happen, which is the safe answer
 * for a schedule the reader can no longer parse.
 */
function unrepresentedEntries(
  projectRoot: string,
  parsed: ReadonlyArray<ScheduleEntry>
): ReadonlyArray<Record<string, unknown>> {
  const path = schedulePath(projectRoot);
  if (!existsSync(path)) return [];
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { entries?: unknown };
  // `Array.isArray` narrows `unknown` to `any[]`; this assertion is what makes the
  // elements `unknown` again, so nothing below inherits an untyped value.
  const listed = Array.isArray(raw.entries) ? (raw.entries as unknown[]) : [];
  const ids = new Set(parsed.map((entry) => entry.id));
  return listed.filter(
    (entry): entry is Record<string, unknown> =>
      typeof entry === 'object' &&
      entry !== null &&
      toScheduleEntry(entry) === null &&
      !sharesIdWithAParsedEntry(entry, ids)
  );
}

/**
 * An unparseable entry that carries the `id` of a parseable one is the single case
 * this write still drops: two entries under one id would make the fold above
 * ambiguous about which one it just stamped.
 */
function sharesIdWithAParsedEntry(entry: object, ids: ReadonlySet<string>): boolean {
  const id = (entry as { id?: unknown }).id;
  return typeof id === 'string' && ids.has(id);
}
