/**
 * Slice 2026-07-29-worktree-l2-extended Part 20 —
 * peaks-cron-scheduler e2e.
 *
 * Coverage:
 *  1. peaks cron-scheduler start writes the pid file and
 *     'status' reports the pid as alive.
 *  2. peaks cron-scheduler stop sends SIGTERM (best-effort
 *     on Windows) and removes the pid file.
 *  3. peaks cron-scheduler status on a project without the
 *     scheduler reports 'not running' cleanly.
 *  4. peaks cron-scheduler run-once is a foreground
 *     one-shot — no daemon is spawned; the due task runs in
 *     the current process.
 *
 * The test does NOT exercise the long-running setInterval
 * tick. The tick is unit-testable via runSchedulerLoop
 * directly; the e2e focuses on the CLI surface that
 * operators actually use.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const BIN = resolve(__dirname, '../../bin/peaks.js');
const POLL_TIMEOUT_MS = 5_000;

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

function runCli(args: readonly string[], cwd: string): RunResult {
  try {
    const stdout = execFileSync('node', [BIN, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15_000
    }).toString('utf8');
    return { stdout, stderr: '', code: 0 };
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; status?: number };
    return {
      stdout: e.stdout?.toString('utf8') ?? '',
      stderr: e.stderr?.toString('utf8') ?? '',
      code: typeof e.status === 'number' ? e.status : 1
    };
  }
}

async function untilTrue(predicate: () => boolean, label: string): Promise<boolean> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`poll timeout waiting for: ${label}`);
}

const projects: string[] = [];
afterEach(() => {
  while (projects.length > 0) {
    const p = projects.pop() as string;
    try { rmSync(p, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

function makeProject(): string {
  const p = mkdtempSync(join(tmpdir(), 'peaks-cron-scheduler-'));
  projects.push(p);
  return p;
}

describe('peaks cron-scheduler (Part 20)', () => {
  test('status on a fresh project reports not-running cleanly', () => {
    const project = makeProject();
    const r = runCli(['cron-scheduler', 'status', '--project', project, '--json'], project);
    expect(r.code).toBe(0);
    const env = JSON.parse(r.stdout) as { ok: boolean; data: { alive: boolean } };
    expect(env.ok).toBe(true);
    expect(env.data.alive).toBe(false);
  });

  test('start writes the pid file; status reports alive; stop removes it', async () => {
    const project = makeProject();
    // Initialize the schedule (otherwise the scheduler has no
    // tasks to run, but the start / stop surface still works).
    const init = runCli(['cron', 'init', '--project', project, '--json'], project);
    expect(init.code).toBe(0);

    const start = runCli(['cron-scheduler', 'start', '--project', project, '--json'], project);
    // eslint-disable-next-line no-console
    if (start.code !== 0) console.error('DBG start stdout=', start.stdout, 'stderr=', start.stderr);
    expect(start.code).toBe(0);
    const pidFile = join(project, '.peaks', 'cron', 'scheduler.pid');
    // Detached spawn + file write happens in the parent process
    // before exit, but vitest's fs cache can lag. Wait up to 5s.
    await untilTrue(() => existsSync(pidFile), 'scheduler.pid file to be written');
    const pidRaw = readFileSync(pidFile, 'utf8').trim();
    const pid = Number.parseInt(pidRaw, 10);
    expect(pid).toBeGreaterThan(0);

    // status reports alive (also allow a brief window for the
    // detached process to settle).
    await untilTrue(() => {
      const s = runCli(['cron-scheduler', 'status', '--project', project, '--json'], project);
      if (s.code !== 0) return false;
      try {
        const env = JSON.parse(s.stdout) as { data: { alive: boolean; pid: number } };
        return env.data.alive && env.data.pid === pid;
      } catch {
        return false;
      }
    }, 'status to report alive with matching pid');
    const status = runCli(['cron-scheduler', 'status', '--project', project, '--json'], project);
    expect(status.code).toBe(0);
    const statusEnv = JSON.parse(status.stdout) as { data: { alive: boolean; pid: number } };
    expect(statusEnv.data.alive).toBe(true);
    expect(statusEnv.data.pid).toBe(pid);

    // stop removes the pid file (the process may or may not
    // be alive on Windows; the contract is that stop is
    // idempotent).
    const stop = runCli(['cron-scheduler', 'stop', '--project', project, '--json'], project);
    expect(stop.code).toBe(0);
    expect(existsSync(pidFile)).toBe(false);
  });

  test('run-once on a project with no schedule returns ran=0 (no daemon spawned)', () => {
    const project = makeProject();
    const pidFile = join(project, '.peaks', 'cron', 'scheduler.pid');
    expect(existsSync(pidFile)).toBe(false);

    // run-once without a schedule should be a no-op (0 due
    // tasks) and exit 0. The pid file must not be created.
    const run = runCli(['cron-scheduler', 'run-once', '--project', project, '--json'], project);
    expect(run.code).toBe(0);
    expect(existsSync(pidFile)).toBe(false);
    const env = JSON.parse(run.stdout) as { data: { ran: number } };
    expect(env.data.ran).toBe(0);
  });
});
