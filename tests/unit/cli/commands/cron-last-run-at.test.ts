// tests/unit/cli/commands/cron-last-run-at.test.ts
//
// rid `2026-10-01-cron-last-run-at-01` (bugfix, test-first) — backlog §2.24, and
// the RATE half of the process-population mechanism in
// `.peaks/docs/diagnosis-2026-10-01-worktree-list-population.md` §9.
//
// THE DEFECT, AS READ AT HEAD `9badd1ac` (not inferred):
//   `src/cli/commands/cron-scheduler-commands.ts` — the daemon tick was
//       const due = listDueTasks(args.projectRoot);
//       for (const task of due) { runTask(args.projectRoot, task); }
//   The `RunRecord` is discarded and `writeSchedule` is never called, so
//   `lastRunAt` stays null. `cron-commands-schedule.ts:212`
//   (`if (e.lastRunAt === null) return true;`) then reports the SAME task as due
//   on every tick. Against `SCHEDULER_TICK_MS = 60_000`
//   (`cron-scheduler-commands.ts:42`) and the built-in `lease-gc-daily`'s
//   `intervalMs = 86_400_000` (`cron-commands-schedule.ts:33-34`) that is a 1440×
//   rate error. `run-once` (`cron-scheduler-commands.ts:300` at `9badd1ac`,
//   `const records = due.map((t) => runTask(projectRoot, t));`) shares it: it
//   prints the records and never writes the schedule back — arm 6 below measures
//   that rather than asserting it.
//
// REPAIR CYCLE 1 (review F1/F4/F5) added three arms here, one per claim the review
// found wider than the code: ONE killed fire driven through BOTH `lastRunAt` writers
// must leave one schedule (they disagreed at `9badd1ac` — `cron-commands-actions.ts:174`
// stamped killed runs and the tick did not); a mid-fire write that the pre-run snapshot
// used to revert; and an entry `toScheduleEntry` (`cron-commands-schedule.ts:129-150`)
// rejects, which a daemon write used to delete.
//
// WHAT THIS FILE REPLACES, AND ONLY THAT: `runTask`. `readSchedule`,
// `listDueTasks`, `schedulePath` and `writeSchedule` stay the real fs-backed
// implementations, so the re-fire the arms count comes from the real due-listing
// and the persistence they assert lands in a real `schedule.json`. `runTask` is
// replaced so a unit test can count fires without booting a CLI per fire
// (`vitest.config.ts` header: the unit suite runs no real subprocess).
//
// KILLED-RUN SEMANTICS PINNED HERE (the open question of §2.24; the rule itself
// lives in `src/cli/commands/cron-scheduler-persist.ts`): a record carrying
// `killed: true` does NOT advance `lastRunAt` — in either writer — so a run that
// never reached a conclusion is not counted as a day's work: the task stays due. A
// record with a definite exit code (0 or non-zero) DOES advance it to
// `record.finishedAt`, i.e. it goes quiet for exactly its own `intervalMs`.
//
// Dimensions (per `.peaks/standards/typescript/testing.md`):
//   render       — the `schedule.json` bytes the daemon writes back.
//   behavior     — `runTask` invocation counts across ticks + the due-listing.
//   integration  — the loop's clock/fs boundary and the `run-once` CLI action.
//   a11y         — OMITTED: this slice adds no human-visible text, exit-code
//                  rendering or envelope shape; `run-once`'s message is unchanged.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { advanceTime, freezeTimeAt } from '../../_setup/clock.js';
import { makeCapturedIo } from '../../_setup/io.js';
import type {
  RunRecord,
  ScheduleEntry
} from '../../../../src/cli/commands/cron-commands-schedule.js';

/** The signature `cron-scheduler-commands.ts` calls `runTask` through. */
type RunTaskFn = (projectRoot: string, task: ScheduleEntry) => RunRecord;

const runTaskSpy = vi.fn<RunTaskFn>();

// The mock deliberately does NOT call `importOriginal()`: measured with it, the real
// `cron-commands.js` evaluates `cron-commands-actions.js` inside its own import, and
// that cycle binds the actions module's `runTask` to the REAL function — `peaks cron
// run` then ran 2 uncounted CLI children (1,173 ms and 567 ms of wall clock) while the
// spy saw only the tick's 2. Listing the three names this graph reads from that path
// (`runTask`, plus the two `cron-commands-schedule.js` re-exports
// `cron-scheduler-commands.ts:40` imports) keeps one `runTask` for every writer.
vi.mock('../../../../src/cli/commands/cron-commands.js', async () => {
  const schedule = await import('../../../../src/cli/commands/cron-commands-schedule.js');
  return {
    runTask: runTaskSpy,
    readSchedule: schedule.readSchedule,
    listDueTasks: schedule.listDueTasks
  };
});

const { registerCronSchedulerCommand, runSchedulerLoop } =
  await import('../../../../src/cli/commands/cron-scheduler-commands.js');
const { handleCronRun } = await import('../../../../src/cli/commands/cron-commands-actions.js');
const { listDueTasks, readSchedule, SCHEDULE_VERSION, schedulePath, writeSchedule } =
  await import('../../../../src/cli/commands/cron-commands-schedule.js');

declareDimensions(
  'tests/unit/cli/commands/cron-last-run-at.test.ts',
  ['render', 'behavior', 'integration'],
  [
    {
      dim: 'a11y',
      reason:
        'no human-visible text, exit-code rendering or envelope shape changes; only the schedule write-back is added'
    }
  ]
);

/** The built-in daily interval (`cron-commands-schedule.ts:33-34`). */
const DAY_MS = 86_400_000;
/** `SCHEDULER_TICK_MS` (`cron-scheduler-commands.ts:42`) — the daemon's period. */
const DAEMON_TICK_MS = 60_000;
/** Ticks under test: the entry tick plus five interval ticks. */
const TICKS = 6;
/** Ticks in the killed-run arm (it must stay due, so it keeps firing). */
const KILLED_TICKS = 3;
/** How long a fire takes, so `finishedAt` differs from `startedAt`. */
const RUN_DURATION_MS = 1_500;
const OPERATOR_TASK_ID = 'operator-added';

function exitStub(): never {
  // `runSchedulerLoop` ends with `process.exit(0)` (:389) — in a vitest fork that
  // would end the worker, so the loop arms stub it and let the promise settle.
  return undefined as never;
}

const projects: string[] = [];

function makeProject(): string {
  const p = mkdtempSync(join(tmpdir(), 'peaks-cron-last-run-at-'));
  projects.push(p);
  return p;
}

function taskEntry(id: string): ScheduleEntry {
  return {
    id,
    name: `${id} daily listing`,
    command: 'worktree',
    args: ['list'],
    intervalMs: DAY_MS,
    lastRunAt: null,
    enabled: true,
    createdAt: Date.now()
  };
}

function finishedRecord(
  taskId: string,
  finishedAt: number,
  exitCode = 0,
  killed = false
): RunRecord {
  return {
    id: `${taskId}-record`,
    taskId,
    startedAt: finishedAt - RUN_DURATION_MS,
    finishedAt,
    exitCode,
    stderr: exitCode === 0 ? '' : 'task failed',
    ...(killed ? { killed: true } : {})
  };
}

/** Run exactly `ticks` tick bodies: one on entry, `ticks - 1` on the interval. */
async function runTicks(project: string, ticks: number): Promise<void> {
  const controller = new AbortController();
  const loop = runSchedulerLoop({
    projectRoot: project,
    tickMs: DAEMON_TICK_MS,
    signal: controller.signal
  });
  advanceTime(DAEMON_TICK_MS * (ticks - 1));
  controller.abort();
  await loop;
}

function storedEntry(project: string, id: string): ScheduleEntry {
  const found = readSchedule(project).entries.find((e) => e.id === id);
  if (found === undefined) throw new Error(`schedule.json lost the entry ${id}`);
  return found;
}

/**
 * Drive `peaks cron run`'s handler — the second writer of `lastRunAt`, and the one F1
 * found disagreeing with the scheduler's. This is the function `registerCronCommand`
 * wires at `cron-commands.ts:283-285`, called directly because loading the real
 * `cron-commands.js` re-introduces the import cycle the mock above avoids. The arms
 * assert this command's `runTask` call count, which is what proves the spy reached the
 * actions module (it did not, before that mock was reshaped).
 */
function runCronRunCommand(project: string, id?: string): void {
  const { io } = makeCapturedIo();
  handleCronRun(io, { project, json: true, ...(id === undefined ? {} : { id }) });
}

// The loop arms drive `setInterval` by hand, so the clock is fake and frozen at
// the project default anchor; `advanceTime` moves it exactly `DAEMON_TICK_MS`
// per tick and `afterEach` restores real timers.
freezeTimeAt();

beforeEach(() => {
  runTaskSpy.mockReset();
  vi.spyOn(process, 'exit').mockImplementation(exitStub);
  // The loop's per-process idempotency guard (`cron-scheduler-commands.ts:349`)
  // refuses a second loop in one process; each arm starts its own, so the flag
  // is cleared between arms.
  delete (process as { __peaksCronScheduler?: boolean }).__peaksCronScheduler;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  while (projects.length > 0) {
    const p = projects.pop() as string;
    try {
      rmSync(p, { recursive: true, force: true });
    } catch {
      /* best-effort, as in tests/integration/cron-scheduler.test.ts */
    }
  }
});

describe('behavior — the daemon tick persists the run it took', () => {
  it('when the loop ticks six times over one due 24-hour task, should run that task exactly once', async () => {
    // given: a temp project whose schedule.json holds one enabled 86_400_000 ms task with lastRunAt null, and a runTask that returns a clean record
    // when: runSchedulerLoop runs its entry tick plus five 60_000 ms interval ticks
    // then: runTask fired once (before the fix: six times, one per tick), the entry's lastRunAt equals record.finishedAt, and a tick one minute later finds nothing due
    const project = makeProject();
    const task = taskEntry('lease-gc-daily');
    writeSchedule(project, { version: SCHEDULE_VERSION, entries: [task] });
    const finishedAt = Date.now() + RUN_DURATION_MS;
    runTaskSpy.mockImplementation((_root, ran) => finishedRecord(ran.id, finishedAt));

    await runTicks(project, TICKS);

    expect(runTaskSpy.mock.calls.length).toBe(1);
    expect(storedEntry(project, 'lease-gc-daily').lastRunAt).toBe(finishedAt);
    expect(listDueTasks(project, finishedAt + DAEMON_TICK_MS).length).toBe(0);
  });

  it('when a task run ends with a non-zero exit code, should timestamp it so it goes quiet for exactly its own interval', async () => {
    // given: one due 24-hour task and a runTask that returns a FAILED (exit 1, not killed) record
    // when: the loop ticks six times
    // then: it fired once, lastRunAt equals finishedAt, so the task is not due a ms before its interval and is due at it
    const project = makeProject();
    writeSchedule(project, { version: SCHEDULE_VERSION, entries: [taskEntry('report-nightly')] });
    const finishedAt = Date.now() + RUN_DURATION_MS;
    runTaskSpy.mockImplementation((_root, ran) => finishedRecord(ran.id, finishedAt, 1));

    await runTicks(project, TICKS);

    expect(runTaskSpy.mock.calls.length).toBe(1);
    expect(storedEntry(project, 'report-nightly').lastRunAt).toBe(finishedAt);
    expect(listDueTasks(project, finishedAt + DAY_MS - 1).length).toBe(0);
    expect(listDueTasks(project, finishedAt + DAY_MS).length).toBe(1);
  });

  it('when a task run was killed by its exec timeout, should leave it due instead of silencing it for a full interval', async () => {
    // given: one due 24-hour task and a runTask that returns a record marked `killed: true`
    // when: the loop ticks three times
    // then: lastRunAt stays null (a run with no conclusion is not a day's work), so this
    //   harness retries every tick it is given — 3 ticks, 3 fires. THE PRODUCTION RATE OF
    //   THAT RETRY IS NOT MEASURED HERE: this stub returns in microseconds. A real killed
    //   fire's spacing is the pair of arms in `cron-exec-timeout.test.ts` ("a killed fire
    //   is spaced by the injected timeout, not by the tick"), which goes through `runTask`'s
    //   third parameter (`cron-commands.ts:209-218`) and is what rule 2 of
    //   `cron-scheduler-persist.ts` quotes, with its win32 limits.
    const project = makeProject();
    writeSchedule(project, { version: SCHEDULE_VERSION, entries: [taskEntry('slow-daily')] });
    const finishedAt = Date.now() + RUN_DURATION_MS;
    runTaskSpy.mockImplementation((_root, ran) => finishedRecord(ran.id, finishedAt, 1, true));

    await runTicks(project, KILLED_TICKS);

    expect(runTaskSpy.mock.calls.length).toBe(KILLED_TICKS);
    expect(storedEntry(project, 'slow-daily').lastRunAt).toBeNull();
  });

  it('when the same killed fire runs through the daemon tick and through peaks cron run, should leave one identical schedule', async () => {
    // given: two identical temp projects, each holding one 24-hour task whose fire is
    //   killed and one whose fire concludes
    // when: the first is driven by a single daemon tick, the second by `peaks cron run`'s
    //   handler — the two writers of `lastRunAt`
    // then: ONE resulting schedule. F1 of the review: at `9badd1ac` the tick left the
    //   killed entry due while `cron run` stamped it `finishedAt`
    //   (`cron-commands-actions.ts:174`, no `killed` test), so the same fire stayed due or
    //   went quiet for a day depending on which command ran it.
    const tickProject = makeProject();
    const runProject = makeProject();
    const entries = [taskEntry('slow-daily'), taskEntry('fast-daily')];
    writeSchedule(tickProject, { version: SCHEDULE_VERSION, entries });
    writeSchedule(runProject, { version: SCHEDULE_VERSION, entries });
    const finishedAt = Date.now() + RUN_DURATION_MS;
    runTaskSpy.mockImplementation((_root, ran) =>
      ran.id === 'slow-daily'
        ? finishedRecord(ran.id, finishedAt, 1, true)
        : finishedRecord(ran.id, finishedAt)
    );

    await runTicks(tickProject, 1);
    runCronRunCommand(runProject);

    expect(runTaskSpy.mock.calls.length).toBe(4);
    expect(readFileSync(schedulePath(tickProject), 'utf8')).toBe(
      readFileSync(schedulePath(runProject), 'utf8')
    );
    expect(storedEntry(tickProject, 'slow-daily').lastRunAt).toBeNull();
    expect(storedEntry(runProject, 'slow-daily').lastRunAt).toBeNull();
    expect(storedEntry(tickProject, 'fast-daily').lastRunAt).toBe(finishedAt);
    expect(storedEntry(runProject, 'fast-daily').lastRunAt).toBe(finishedAt);
  });
});

describe('integration — the write-back keeps what the daemon did not run', () => {
  it('when an operator adds a task while the daemon is running one, should write both entries back with the added one unchanged', async () => {
    // given: one due task, and a runTask that — mid-flight, after listDueTasks and before the write — adds a second entry to schedule.json
    // when: the loop runs exactly one tick
    // then: both entries are on disk, the run entry is timestamped, and the mid-flight entry is stored field-for-field as the operator wrote it (and was not run this tick)
    const project = makeProject();
    const running = taskEntry('lease-gc-daily');
    const added = taskEntry(OPERATOR_TASK_ID);
    writeSchedule(project, { version: SCHEDULE_VERSION, entries: [running] });
    const finishedAt = Date.now() + RUN_DURATION_MS;
    runTaskSpy.mockImplementation((_root, ran) => {
      const current = readSchedule(_root);
      writeSchedule(_root, { version: SCHEDULE_VERSION, entries: [...current.entries, added] });
      return finishedRecord(ran.id, finishedAt);
    });

    await runTicks(project, 1);

    expect(runTaskSpy.mock.calls.length).toBe(1);
    const file = readSchedule(project);
    expect(file.entries.length).toBe(2);
    expect(storedEntry(project, 'lease-gc-daily').lastRunAt).toBe(finishedAt);
    expect(storedEntry(project, OPERATOR_TASK_ID)).toEqual(added);
  });

  it('when another writer stamps the schedule while peaks cron run is mid-fire, should not revert that write', async () => {
    // given: TWO due tasks, this command asked to run only the first (`--id`), and a fire
    //   during which a second writer stamps the OTHER task and adds a third entry — what
    //   the daemon does during the up-to-`EXEC_TIMEOUT_MS` (300,000 ms) this command can
    //   block per task
    // when: `peaks cron run` finishes and writes
    // then: the task it ran carries its own record's stamp, the bystander keeps the OTHER
    //   writer's stamp instead of reverting to `null`, and the mid-fire entry survives
    //   field-for-field (F4: the write used to come from the pre-run snapshot, which did
    //   both; the bystander is the assertion with teeth, because for the task this command
    //   runs the old fold re-stamped `finishedAt` anyway). Still last-writer-wins on the
    //   value — there is no lock, and no arm asserts a closed one.
    const project = makeProject();
    const running = taskEntry('lease-gc-daily');
    const bystander = taskEntry('report-nightly');
    writeSchedule(project, { version: SCHEDULE_VERSION, entries: [running, bystander] });
    const otherWriterStamp = Date.now() + 1;
    const landedMidFire = taskEntry('operator-added-mid-run');
    const finishedAt = Date.now() + RUN_DURATION_MS;
    runTaskSpy.mockImplementation((root, ran) => {
      const midFire = readSchedule(root);
      writeSchedule(root, {
        version: SCHEDULE_VERSION,
        entries: [
          ...midFire.entries.map((entry) =>
            entry.id === bystander.id ? { ...entry, lastRunAt: otherWriterStamp } : entry
          ),
          landedMidFire
        ]
      });
      return finishedRecord(ran.id, finishedAt);
    });

    runCronRunCommand(project, 'lease-gc-daily');

    expect(runTaskSpy.mock.calls.length).toBe(1);
    expect(storedEntry(project, 'lease-gc-daily').lastRunAt).toBe(finishedAt);
    expect(storedEntry(project, 'report-nightly').lastRunAt).toBe(otherWriterStamp);
    expect(storedEntry(project, 'operator-added-mid-run')).toEqual(landedMidFire);
  });
});

describe('render — the schedule file the daemon writes', () => {
  it('when the daemon persists a run, should rewrite schedule.json keeping the version and every other field of the entry', async () => {
    // given: a schedule.json holding one due task with distinctive fields
    // when: the loop runs exactly one tick
    // then: the bytes on disk are a version-1 file whose single entry kept id/name/command/args/intervalMs/enabled/createdAt and changed only lastRunAt
    const project = makeProject();
    const task = taskEntry('lease-gc-daily');
    writeSchedule(project, { version: SCHEDULE_VERSION, entries: [task] });
    const finishedAt = Date.now() + RUN_DURATION_MS;
    runTaskSpy.mockImplementation((_root, ran) => finishedRecord(ran.id, finishedAt));

    await runTicks(project, 1);

    const raw = JSON.parse(readFileSync(schedulePath(project), 'utf8')) as {
      version: number;
      entries: ScheduleEntry[];
    };
    expect(raw.version).toBe(1);
    expect(raw.entries.length).toBe(1);
    const written = storedEntry(project, task.id);
    expect(written.id).toBe(task.id);
    expect(written.name).toBe(task.name);
    expect(written.command).toBe(task.command);
    expect(written.args).toEqual(task.args);
    expect(written.intervalMs).toBe(task.intervalMs);
    expect(written.enabled).toBe(true);
    expect(written.createdAt).toBe(task.createdAt);
    expect(written.lastRunAt).toBe(finishedAt);
  });

  it('when schedule.json holds an entry the schedule reader rejects, should carry it through the daemon write instead of deleting it', async () => {
    // given: one parseable due task plus a hand-edited entry with no `name`, which
    //   `toScheduleEntry` (`cron-commands-schedule.ts:129-150`) returns null for, so
    //   `readSchedule` never sees it
    // when: the loop runs one tick and the daemon writes the schedule back
    // then: the rejected entry is still in the file with the fields the operator wrote —
    //   including the `note` key this reader never heard of — and the due entry got its
    //   stamp. F5 of the review: "entries the daemon did NOT run survive the write" was
    //   true only of entries the reader can parse. The chosen behavior is PRESERVE, not
    //   refuse: refusing would stop every stamp landing and re-open §2.24 for the whole
    //   schedule the moment one entry has a typo.
    const project = makeProject();
    const parseable = taskEntry('lease-gc-daily');
    writeSchedule(project, { version: SCHEDULE_VERSION, entries: [parseable] });
    const handEdited = {
      id: 'hand-edited',
      command: 'worktree',
      args: ['list'],
      intervalMs: DAY_MS,
      lastRunAt: null,
      enabled: true,
      createdAt: 1,
      note: 'added by hand, no name field'
    };
    writeFileSync(
      schedulePath(project),
      `${JSON.stringify({ version: SCHEDULE_VERSION, entries: [parseable, handEdited] }, null, 2)}\n`,
      'utf8'
    );
    const finishedAt = Date.now() + RUN_DURATION_MS;
    runTaskSpy.mockImplementation((_root, ran) => finishedRecord(ran.id, finishedAt));

    await runTicks(project, 1);

    const rawFile = JSON.parse(readFileSync(schedulePath(project), 'utf8')) as {
      version: number;
      entries: Array<Record<string, unknown>>;
    };
    expect(rawFile.version).toBe(1);
    expect(rawFile.entries.length).toBe(2);
    expect(rawFile.entries.filter((entry) => entry.id === 'hand-edited').length).toBe(1);
    expect(rawFile.entries[1]).toEqual(handEdited);
    expect(storedEntry(project, 'lease-gc-daily').lastRunAt).toBe(finishedAt);
  });
});

describe('integration — run-once is held to the same rule', () => {
  it('when cron-scheduler run-once runs a due task, should persist lastRunAt so the next invocation finds nothing due', async () => {
    // given: the `cron-scheduler` command registered on a fresh program, a schedule holding one due task, and a clean runTask
    // when: `cron-scheduler run-once --json` is invoked twice in a row
    // then: the first reports ran=1 and writes lastRunAt; the second reports ran=0 and does not fire again (before the fix it reported ran=1 twice)
    const project = makeProject();
    writeSchedule(project, { version: SCHEDULE_VERSION, entries: [taskEntry('lease-gc-daily')] });
    const finishedAt = Date.now() + RUN_DURATION_MS;
    runTaskSpy.mockImplementation((_root, ran) => finishedRecord(ran.id, finishedAt));
    const { io, captured } = makeCapturedIo();
    const program = new Command();

    registerCronSchedulerCommand(program, io);
    await program.parseAsync(['cron-scheduler', 'run-once', '--project', project, '--json'], {
      from: 'user'
    });
    await program.parseAsync(['cron-scheduler', 'run-once', '--project', project, '--json'], {
      from: 'user'
    });

    const envelopes = captured
      .lines()
      .map((line) => JSON.parse(line) as { data: { ran: number; records: RunRecord[] } });
    expect(envelopes.map((env) => env.data.ran)).toEqual([1, 0]);
    expect(runTaskSpy.mock.calls.length).toBe(1);
    expect(storedEntry(project, 'lease-gc-daily').lastRunAt).toBe(finishedAt);
  });
});
