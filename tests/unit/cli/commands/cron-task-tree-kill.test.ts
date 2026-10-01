// tests/unit/cli/commands/cron-task-tree-kill.test.ts
//
// rid 2026-10-01-cron-task-tree-kill-01 (bugfix, test-first) —
// `runTask` ran every task through `execSync`, i.e. through `cmd.exe` on
// Windows. `execSync`'s `timeout` kills THE SHELL; the node process that shell
// launched is left running and owned by nobody. Measured in
// `.peaks/docs/diagnosis-2026-10-01-worktree-list-population.md` §9 (body
// `node -e "setTimeout(…,60000)"`, injected timeout 1500 ms): the call returned
// at 1519 ms with `ETIMEDOUT`/`SIGTERM` while the task child was still alive at
// +0, +3 and +6 s. The record written for that run was `exitCode 1, stderr ''`
// (`err.status` is null on a timed-out `execSync`), so `history.jsonl` reported
// a definite failure for work that may still have been running (§2.23).
//
// THIS FILE COUNTS OPERATING-SYSTEM PROCESSES. Asserting that `runTask`
// returned is not evidence that anything died — that is the exact claim this
// campaign already sedimented against (`.peaks/memory/`). Every survivor
// assertion counts processes whose command line carries a per-run MARKER token
// that the fixture puts in the task's OWN argv — never a path fragment: this
// repo's session directories live under a path containing `worktrees`, and a
// path-fragment filter is what misled the original investigation (diagnosis §5).
// A failed enumeration THROWS; it is never read as "zero survivors".
//
// WHAT THIS SUITE DOES **NOT** ASSERT — the TASK PROCESS ONLY. No arm here
// spawns a descendant, and `runTask` asks for no descendant kill at all (no
// `detached`, no `taskkill /T`, no job object, no process group), so "the tree is
// reaped" is not a claim this file protects. Descendants were OBSERVED to die on
// win32 — a review probe saw the direct task child go 2 → 4 times (an async node
// grandchild, an `execFileSync('git')` shape, a non-node holder), every zero
// backed by a live count of 2 just before the kill — but the mechanism is not
// understood, so reaping is not a guarantee and not a contract here. The win32
// enumerator does read EVERY process, not just `node`/`cmd`, so a non-node
// descendant at least cannot hide behind the filter (F3).
//
// The fixture is a fake `peaks` CLI written into the throwaway workspace, so no
// arm can run the real `peaks worktree` task against the live repo. It is
// installed in BOTH shapes the task can be reached through — `<ws>/bin/peaks.js`
// (the shell-free `process.execPath` + JS-entry spawn) and `<ws>/bin/peaks.cmd`
// on the prepended `PATH` (today's `execSync` shell lookup) — so the red arm and
// the green arm execute the same task body, and the "the fixture really ran"
// check (the argv dump the fake writes) fails loudly if either lookup misses.
//
// Dimensions (per `.peaks/standards/typescript/testing.md`):
//   integration — the subprocess boundary: survivor counts after `runTask`
//                 returns, the positive control that the child really started,
//                 and argv integrity across the spawn.
//   behavior    — the record branches (killed / failed / succeeded) and that a
//                 killed record is not shaped like a failed one.
//   render      — the `history.jsonl` row shape on disk.
//   a11y        — the text an operator reads for a task that was killed.

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';
import { runTask, type ScheduleEntry } from '~/src/cli/commands/cron-commands';

declareDimensions('tests/unit/cli/commands/cron-task-tree-kill.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const getWs = withTmpWorkspacePerTest('peaks-cron-tree-kill-');

/** Raw line for the hold task: ≫ every check point, so a survivor is alive. */
const TASK_HOLD_KILL_MS = 30_000;
/** Raw line for the control task: ≪ the generous timeout, so it exits 0. */
const TASK_HOLD_CONTROL_MS = 300;
/** Injected exec timeout for a kill arm (the value the diagnosis probed with). */
const KILL_TIMEOUT_MS = 1_500;
/** Injected exec timeout for an arm whose task is meant to finish. */
const GENEROUS_TIMEOUT_MS = 20_000;
/** Extra wall clock after `runTask` returns before the second survivor count. */
const SETTLE_MS = 1_500;
/** Wall clock a process enumeration is allowed before it counts as a failure. */
const ENUMERATE_TIMEOUT_MS = 30_000;
/** The process table is big; 32 MB of command lines is not a risk of overflow. */
const ENUMERATE_BUFFER_BYTES = 32 * 1024 * 1024;
/** Exit code the fake task exits with on the plain-failure branch. */
const FAIL_EXIT_CODE = 3;
/** Per-test budget: arms here spawn real processes and enumerate the process table. */
const TEST_BUDGET_MS = 90_000;

const TASK_COMMAND = 'treekill-probe';
const HOLD_FLAG = '--hold';
const FAIL_FLAG = '--fail';
const ARGV_DUMP = 'argv.json';
const HISTORY_REL_PATH = join('.peaks', 'cron', 'history.jsonl');
/** The one task the REAL `bin/peaks.js` answers with exit 0 and no side effects. */
const VERSION_COMMAND = '--version';
/**
 * The package root of the checkout RUNNING this test. `resolveTaskEntry` derives
 * its fallback candidate three levels below the module under test
 * (`src/cli/commands`), which is the same root this file sits four below.
 */
const runningPackageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** The fake `peaks` entry body — see the header for why it exists. */
function fakeEntrySource(): string {
  return [
    '// Fake peaks CLI entry — fixture for rid 2026-10-01-cron-task-tree-kill-01.',
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    'const argv = process.argv.slice(2);',
    `fs.writeFileSync(path.join(__dirname, '..', ${JSON.stringify(ARGV_DUMP)}), JSON.stringify(argv));`,
    `const failAt = argv.indexOf(${JSON.stringify(FAIL_FLAG)});`,
    'if (failAt !== -1) {',
    "  process.stderr.write('fake task stderr\\n');",
    '  process.exit(Number(argv[failAt + 1]));',
    '}',
    `const holdAt = argv.indexOf(${JSON.stringify(HOLD_FLAG)});`,
    'if (holdAt !== -1) setTimeout(() => {}, Number(argv[holdAt + 1]));',
    ''
  ].join('\n');
}

/** The `.cmd` shim today's `execSync` shell looks `peaks` up through. */
const FAKE_CMD_SHIM = '@echo off\r\nnode "%~dp0peaks.js" %*\r\n';

/** A task body running the fake entry, holding for `holdMs` unless null. */
function taskEntry(marker: string, argv: ReadonlyArray<string>): ScheduleEntry {
  return {
    id: 'tree-kill-probe',
    name: 'fake-CLI tree-kill probe',
    command: TASK_COMMAND,
    args: [...argv, marker],
    intervalMs: GENEROUS_TIMEOUT_MS,
    lastRunAt: null,
    enabled: true,
    createdAt: Date.now()
  };
}

function holdArgs(holdMs: number): string[] {
  return [HOLD_FLAG, String(holdMs)];
}

/** A task that answers immediately: `peaks --version`, no hold, no fail flag. */
function versionTask(): ScheduleEntry {
  return {
    id: 'unbuilt-entry-probe',
    name: 'fake-CLI unbuilt-entry probe',
    command: VERSION_COMMAND,
    args: [],
    intervalMs: GENEROUS_TIMEOUT_MS,
    lastRunAt: null,
    enabled: true,
    createdAt: Date.now()
  };
}

const markerPids: number[] = [];
let savedPath: string | null = null;

afterEach(() => {
  // Never leave an arm's process behind, whatever the arm asserted.
  for (const pid of markerPids.splice(0, markerPids.length)) killProcess(pid);
  if (savedPath !== null) {
    process.env.PATH = savedPath;
    savedPath = null;
  }
});

/**
 * Install the fake task CLI in the workspace and point `PATH` at it, so the
 * pre-fix shell lookup and the post-fix shell-free lookup reach one body.
 * Returns the unique argv marker for this test.
 */
function installFakeTaskCli(workspaceRoot: string): string {
  const binDir = join(workspaceRoot, 'bin');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(binDir, 'peaks.js'), fakeEntrySource(), 'utf8');
  // `resolveTaskEntry` accepts an entry only when its package is BUILT —
  // `bin/peaks.js` imports `../dist/cli/index.js` relative to itself (F1, repair
  // cycle 1) — so the fixture carries the same build marker a real package root
  // has, and these arms still exercise the PROJECT entry.
  mkdirSync(join(workspaceRoot, 'dist', 'cli'), { recursive: true });
  writeFileSync(join(workspaceRoot, 'dist', 'cli', 'index.js'), '', 'utf8');
  if (process.platform === 'win32') {
    writeFileSync(join(binDir, 'peaks.cmd'), FAKE_CMD_SHIM, 'utf8');
  }
  savedPath = process.env.PATH ?? '';
  process.env.PATH = `${binDir}${delimiter}${savedPath}`;
  return newMarker();
}

function newMarker(): string {
  return `peaks-treekill-${randomUUID()}`;
}

/** argv the fake entry actually received (throws when the fixture never ran). */
function readArgvDump(workspaceRoot: string): ReadonlyArray<string> {
  const dumpPath = join(workspaceRoot, ARGV_DUMP);
  expect(existsSync(dumpPath), `fixture never ran: no ${ARGV_DUMP} was written`).toBe(true);
  return JSON.parse(readFileSync(dumpPath, 'utf8')) as ReadonlyArray<string>;
}

/** Fail loudly, never "0", when the process table could not be read. */
function enumerate(command: string, args: ReadonlyArray<string>): string {
  const res = spawnSync(command, [...args], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: ENUMERATE_TIMEOUT_MS,
    maxBuffer: ENUMERATE_BUFFER_BYTES
  });
  if (res.error !== undefined || res.status !== 0) {
    throw new Error(
      `process enumeration did not run (${command}): ${
        res.error?.message ?? res.stderr.slice(0, 200)
      }`
    );
  }
  return res.stdout ?? '';
}

type ProcessRow = { readonly pid: number; readonly commandLine: string };

/**
 * Every live process on win32, every live process on the POSIX platforms this
 * repo runs on. Anything else throws — an unimplemented enumeration must never
 * read as "nothing survived".
 *
 * The win32 filter deliberately does NOT narrow by image name: keeping only
 * `node.exe`/`cmd.exe` made a surviving `git.exe` descendant (what the real
 * `peaks worktree` subcommands spawn) read as zero survivors. Identity is the
 * per-run argv marker, matched in JS, so widening costs rows and no false hits.
 */
function listProcesses(): ReadonlyArray<ProcessRow> {
  if (process.platform === 'win32') {
    const script =
      'Get-CimInstance Win32_Process | ' +
      'ForEach-Object { [string]$_.ProcessId + [char]9 + [string]$_.CommandLine }';
    return enumerate('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
      .split(/\r?\n/)
      .map((line) => {
        const splitAt = line.indexOf('\t');
        return splitAt < 0
          ? null
          : { pid: Number(line.slice(0, splitAt)), commandLine: line.slice(splitAt + 1) };
      })
      .filter((row): row is ProcessRow => row !== null && Number.isFinite(row.pid) && row.pid > 0);
  }
  if (process.platform === 'linux' || process.platform === 'darwin') {
    return enumerate('ps', ['-eo', 'pid=,args='])
      .split(/\r?\n/)
      .map((line) => {
        const match = /^\s*(\d+)\s+(.*)$/.exec(line);
        return match === null || match[1] === undefined || match[2] === undefined
          ? null
          : { pid: Number(match[1]), commandLine: match[2] };
      })
      .filter((row): row is ProcessRow => row !== null);
  }
  throw new Error(
    `cron-task-tree-kill: process enumeration is not implemented on ${process.platform}`
  );
}

/** Processes still alive whose argv carries this arm's unique marker. */
function markedProcesses(marker: string): ReadonlyArray<ProcessRow> {
  return listProcesses().filter((row) => row.commandLine.includes(marker));
}

function killProcess(pid: number): void {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], {
      stdio: 'ignore',
      windowsHide: true
    });
    return;
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* already gone — best effort */
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

describe('integration — a timed-out task is reaped, not orphaned', () => {
  it(
    'leaves zero marker-tagged processes alive after runTask returns',
    { timeout: TEST_BUDGET_MS },
    () => {
      const ws = getWs();
      const marker = installFakeTaskCli(ws.path);
      const record = runTask(
        ws.path,
        taskEntry(marker, holdArgs(TASK_HOLD_KILL_MS)),
        KILL_TIMEOUT_MS
      );
      // The fixture — not the installed peaks — ran, and the OS process table
      // is what answers the question.
      expect(readArgvDump(ws.path)).toContain(marker);
      const immediate = markedProcesses(marker);
      markerPids.push(...immediate.map((row) => row.pid));
      sleepSync(SETTLE_MS);
      const settled = markedProcesses(marker);
      expect({ immediate: immediate.length, settled: settled.length }).toEqual({
        immediate: 0,
        settled: 0
      });
      expect(record.exitCode).not.toBe(0);
    }
  );

  it(
    'positive control: the same fake entry under a generous timeout exits 0 and really ran',
    { timeout: TEST_BUDGET_MS },
    () => {
      const ws = getWs();
      const marker = installFakeTaskCli(ws.path);
      const record = runTask(
        ws.path,
        taskEntry(marker, holdArgs(TASK_HOLD_CONTROL_MS)),
        GENEROUS_TIMEOUT_MS
      );
      expect(record.exitCode).toBe(0);
      expect(readArgvDump(ws.path)).toContain(marker);
      expect(markedProcesses(marker)).toHaveLength(0);
    }
  );

  it(
    'passes an argument with a space and an argument with a quote as single argv elements',
    { timeout: TEST_BUDGET_MS },
    () => {
      const ws = getWs();
      const marker = installFakeTaskCli(ws.path);
      const spaced = 'two words';
      const quoted = 'say "hi"';
      const record = runTask(ws.path, taskEntry(marker, [spaced, quoted]), GENEROUS_TIMEOUT_MS);
      expect(record.exitCode).toBe(0);
      expect(readArgvDump(ws.path)).toEqual([TASK_COMMAND, spaced, quoted, marker]);
    }
  );

  it(
    'never schedules work into an unbuilt checkout entry (bin/peaks.js without its dist)',
    { timeout: TEST_BUDGET_MS },
    () => {
      // F1 (review of rid 2026-10-01-cron-task-tree-kill-01). `bin/peaks.js`
      // imports `../dist/cli/index.js` relative to ITSELF, so every bare
      // checkout and git worktree — including the worktrees this project runs
      // its own sessions in — has the entry WITHOUT the build. Preferring it on
      // `existsSync` alone recorded `exitCode 1` / "peaks-loop: internal module
      // not found" on every fire where the pre-fix PATH `peaks` shim ran the
      // installed CLI. The rule under test: a candidate is used only if it can
      // boot; otherwise the RUNNING package's entry takes the task (what the
      // PATH shim resolved to), and only when that cannot boot either is the run
      // a loud fail-closed record.
      const ws = getWs();
      installFakeTaskCli(ws.path);
      rmSync(join(ws.path, 'dist'), { recursive: true, force: true }); // unbuilt root
      const record = runTask(ws.path, versionTask(), GENEROUS_TIMEOUT_MS);
      // (a) THE UNBUILT ENTRY NEVER RAN: the fake dumps its argv at startup, so
      // a dump here means work was scheduled into an entry that cannot boot.
      expect(existsSync(join(ws.path, ARGV_DUMP))).toBe(false);
      // (b) not the F1 symptom, and never a silent non-zero with no explanation.
      expect(record.stderr).not.toContain('internal module not found');
      expect(record.exitCode === 0 || record.stderr.length > 0).toBe(true);
      // Which of the two honest outcomes follows depends only on whether the
      // checkout running this test is built, so assert the branch actually in
      // hand rather than a disjunction.
      if (existsSync(join(runningPackageRoot, 'dist', 'cli', 'index.js'))) {
        expect(record.exitCode).toBe(0); // the fallback entry booted and answered
      } else {
        expect(record.exitCode).not.toBe(0);
        expect(record.stderr).toContain('task not run'); // fails closed, naming why
      }
    }
  );
});

describe('behavior — the record branches on killed / failed / succeeded', () => {
  it('marks a task that outlived its timeout as killed', { timeout: TEST_BUDGET_MS }, () => {
    const ws = getWs();
    const marker = installFakeTaskCli(ws.path);
    const record = runTask(
      ws.path,
      taskEntry(marker, holdArgs(TASK_HOLD_KILL_MS)),
      KILL_TIMEOUT_MS
    );
    for (const row of markedProcesses(marker)) markerPids.push(row.pid);
    expect(record.killed).toBe(true);
  });

  it(
    'leaves a plain failure unmarked and carries the child exit code and stderr',
    { timeout: TEST_BUDGET_MS },
    () => {
      const ws = getWs();
      const marker = installFakeTaskCli(ws.path);
      const record = runTask(
        ws.path,
        taskEntry(marker, [FAIL_FLAG, String(FAIL_EXIT_CODE)]),
        GENEROUS_TIMEOUT_MS
      );
      expect(record.exitCode).toBe(FAIL_EXIT_CODE);
      expect(record.killed).toBeUndefined();
      expect(record.stderr).toContain('fake task stderr');
    }
  );

  it(
    'records a killed task in a shape a plain failure cannot produce',
    { timeout: TEST_BUDGET_MS },
    () => {
      const ws = getWs();
      const marker = installFakeTaskCli(ws.path);
      const killed = runTask(
        ws.path,
        taskEntry(marker, holdArgs(TASK_HOLD_KILL_MS)),
        KILL_TIMEOUT_MS
      );
      for (const row of markedProcesses(marker)) markerPids.push(row.pid);
      const failed = runTask(
        ws.path,
        taskEntry(marker, [FAIL_FLAG, String(FAIL_EXIT_CODE)]),
        GENEROUS_TIMEOUT_MS
      );
      expect(failed.killed).toBeUndefined();
      expect(failed.stderr).not.toBe('');
      expect(killed.stderr).not.toBe(failed.stderr);
      expect(killed.stderr.length).toBeGreaterThan(0);
    }
  );
});

describe('render — the history.jsonl row says which of the two happened', () => {
  it(
    'appends a killed row carrying the killed marker and a non-empty stderr',
    { timeout: TEST_BUDGET_MS },
    () => {
      const ws = getWs();
      const marker = installFakeTaskCli(ws.path);
      runTask(ws.path, taskEntry(marker, holdArgs(TASK_HOLD_KILL_MS)), KILL_TIMEOUT_MS);
      for (const row of markedProcesses(marker)) markerPids.push(row.pid);
      const row = readHistoryRow(ws.path, -1);
      expect(row.exitCode).not.toBe(0);
      expect(row.killed).toBe(true);
      expect(String(row.stderr).length).toBeGreaterThan(0);
    }
  );

  it('appends a failure row with no killed key at all', { timeout: TEST_BUDGET_MS }, () => {
    const ws = getWs();
    const marker = installFakeTaskCli(ws.path);
    runTask(ws.path, taskEntry(marker, [FAIL_FLAG, String(FAIL_EXIT_CODE)]), GENEROUS_TIMEOUT_MS);
    const row = readHistoryRow(ws.path, -1);
    expect(row.exitCode).toBe(FAIL_EXIT_CODE);
    expect(Object.hasOwn(row, 'killed')).toBe(false);
  });
});

/** Last (or nth) row of the workspace's cron history. */
function readHistoryRow(workspaceRoot: string, index: number): Record<string, unknown> {
  const raw = readFileSync(join(workspaceRoot, HISTORY_REL_PATH), 'utf8');
  const rows = raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const row = rows.at(index);
  expect(row, 'no history row was written').toBeDefined();
  return row as Record<string, unknown>;
}

describe('a11y — an operator reading the record learns the task was killed', () => {
  it('names the timeout in the stderr text of a killed record', { timeout: TEST_BUDGET_MS }, () => {
    const ws = getWs();
    const marker = installFakeTaskCli(ws.path);
    const record = runTask(
      ws.path,
      taskEntry(marker, holdArgs(TASK_HOLD_KILL_MS)),
      KILL_TIMEOUT_MS
    );
    for (const row of markedProcesses(marker)) markerPids.push(row.pid);
    expect(record.stderr.toLowerCase()).toContain('timeout');
    expect(record.stderr).toContain(String(KILL_TIMEOUT_MS));
  });
});
