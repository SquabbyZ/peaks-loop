/**
 * Slice 2026-07-29-worktree-l2-extended Part 3.A.3 — auto-release
 * e2e (dispatch --isolation worktree → heartbeat --status done →
 * release fires).
 *
 * Pre-Part-3 sub-agents that received `peaks sub-agent dispatch
 * --isolation worktree` had to remember to call
 * `peaks worktree release --lease-id <id>` before exiting. If
 * they forgot, the lease sat until the next `peaks worktree gc`
 * pass — usually 30+ minutes of zombie worktree + branch.
 *
 * Part 3.A.1 persisted the leaseId on the dispatch record.
 * Part 3.A.2 fired the release on terminal heartbeat. This test
 * is the end-to-end proof:
 *
 *   1. tmp git repo + commit-1
 *   2. dispatch --isolation worktree → spawn writes a lease,
 *      dispatch record carries leaseId + toolCall.args.env
 *   3. heartbeat --status done against the dispatch record
 *   4. wait briefly (release is detached best-effort)
 *   5. assert: lease file status=released, worktree dir gone,
 *      branch pruned from git's worktree admin table
 *
 * Failure modes tested:
 *   - non-terminal heartbeat (e.g. --status running) does NOT
 *     fire the release; lease + worktree remain intact.
 *   - heartbeat on a record without leaseId is a clean no-op
 *     (no spawn, lease state unchanged).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const BIN = resolve(__dirname, '../../bin/peaks.js');
const POLL_INTERVAL_MS = 200;
const POLL_TIMEOUT_MS = 10_000;

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
      timeout: 30_000
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

interface DispatchEnv {
  readonly ok: true;
  readonly data: {
    readonly leaseId: string;
    readonly worktreePath: string;
    readonly worktreeBranch: string;
    readonly dispatchRecordPath: string;
  };
}

const projects: string[] = [];
afterEach(() => {
  while (projects.length > 0) {
    const p = projects.pop() as string;
    try { rmSync(p, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

function initRepo(): string {
  const project = mkdtempSync(join(tmpdir(), 'peaks-p3a3-auto-'));
  projects.push(project);
  execFileSync('git', ['init', '-q', '-b', 'main', project], { stdio: 'pipe' });
  execFileSync('git', ['-C', project, 'config', 'user.email', 'p3a3@test'], { stdio: 'pipe' });
  execFileSync('git', ['-C', project, 'config', 'user.name', 'p3a3'], { stdio: 'pipe' });
  execFileSync('git', ['-C', project, 'commit', '--allow-empty', '-m', 'init', '-q'], { stdio: 'pipe' });
  return project;
}

/** Poll a predicate until it returns true or the deadline elapses. */
async function untilTrue(predicate: () => boolean, label: string): Promise<boolean> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`poll timeout (${POLL_TIMEOUT_MS}ms) waiting for: ${label}`);
}

describe('peaks sub-agent dispatch --isolation worktree auto-release (Part 3.A.3)', () => {
  test('happy path: dispatch + heartbeat done → release fires automatically', async () => {
    const project = initRepo();
    const sessionId = '2026-07-29-p3a3-happy';
    const requestId = '2026-07-29-p3a3-happy-rid';

    // 1. dispatch with --isolation worktree
    const dispatch = runCli([
      'sub-agent', 'dispatch', 'rd',
      '--prompt', 'p3a3 auto-release probe',
      '--request-id', requestId,
      '--session-id', sessionId,
      '--project', project,
      '--isolation', 'worktree',
      '--json'
    ], project);
    expect(dispatch.code).toBe(0);
    const env = JSON.parse(dispatch.stdout) as DispatchEnv;
    expect(env.ok).toBe(true);
    const lid = env.data.leaseId;
    const wtPath = env.data.worktreePath;
    expect(lid).toMatch(/^[a-f0-9]{16}$/);
    expect(existsSync(wtPath)).toBe(true);
    const leaseFile = join(project, '.peaks', '_runtime', sessionId, 'worktree-leases', lid + '.json');
    expect(existsSync(leaseFile)).toBe(true);

    // 2. heartbeat --status done against the dispatch record
    const heartbeat = runCli([
      'sub-agent', 'heartbeat',
      '--record', env.data.dispatchRecordPath,
      '--status', 'done',
      '--progress', '100',
      '--project', project,
      '--json'
    ], project);
    expect(heartbeat.code).toBe(0);

    // 3. wait for the detached release to land (best-effort, async)
    await untilTrue(() => {
      try {
        const raw = JSON.parse(readFileSync(leaseFile, 'utf8')) as { status: string };
        return raw.status === 'released';
      } catch {
        return false;
      }
    }, 'lease file status=released');

    // 4. assert post-conditions
    const released = JSON.parse(readFileSync(leaseFile, 'utf8')) as { status: string };
    expect(released.status).toBe('released');
    expect(existsSync(wtPath)).toBe(false);
    // git worktree list should NOT include the path anymore (release
    // ran `git worktree remove --force`); gc would add `git worktree
    // prune` but we don't run gc here — the admin table is
    // best-effort cleaned by git itself on the next `worktree list`.
    const wtList = execFileSync('git', ['-C', project, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' });
    expect(wtList).not.toContain(wtPath);
  });

  test('non-terminal heartbeat (running) does NOT fire release', async () => {
    const project = initRepo();
    const sessionId = '2026-07-29-p3a3-running';
    const requestId = '2026-07-29-p3a3-running-rid';

    const dispatch = runCli([
      'sub-agent', 'dispatch', 'rd',
      '--prompt', 'p3a3 non-terminal probe',
      '--request-id', requestId,
      '--session-id', sessionId,
      '--project', project,
      '--isolation', 'worktree',
      '--json'
    ], project);
    expect(dispatch.code).toBe(0);
    const env = JSON.parse(dispatch.stdout) as DispatchEnv;
    const lid = env.data.leaseId;
    const wtPath = env.data.worktreePath;
    const leaseFile = join(project, '.peaks', '_runtime', sessionId, 'worktree-leases', lid + '.json');

    // heartbeat --status running should NOT auto-release
    const heartbeat = runCli([
      'sub-agent', 'heartbeat',
      '--record', env.data.dispatchRecordPath,
      '--status', 'running',
      '--progress', '50',
      '--project', project,
      '--json'
    ], project);
    expect(heartbeat.code).toBe(0);

    // Give the would-be release time to fire if it were going to.
    // Slice 2026-07-30-nightshift: relaxed from a fixed 1500ms to a
    // bounded polling loop (3 attempts × 500ms = 1.5s ceiling, but
    // the test exits early as soon as the file is read). This
    // preserves the timing semantics on fast runners while not
    // blocking the slow-project CI on a fixed sleep.
    for (let i = 0; i < 3; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      if (!existsSync(leaseFile) || !existsSync(wtPath)) break;
    }

    // Lease + worktree still alive
    const stillActive = JSON.parse(readFileSync(leaseFile, 'utf8')) as { status: string };
    expect(stillActive.status).toBe('active');
    expect(existsSync(wtPath)).toBe(true);
  });

  test('heartbeat on a record without leaseId is a clean no-op (no spawn, no crash)', async () => {
    const project = initRepo();
    const sessionId = '2026-07-29-p3a3-nolease';
    const requestId = '2026-07-29-p3a3-nolease-rid';

    // dispatch WITHOUT --isolation (no lease spawned)
    const dispatch = runCli([
      'sub-agent', 'dispatch', 'rd',
      '--prompt', 'p3a3 no-lease probe',
      '--request-id', requestId,
      '--session-id', sessionId,
      '--project', project,
      '--json'
    ], project);
    expect(dispatch.code).toBe(0);
    const env = JSON.parse(dispatch.stdout) as { data: { dispatchRecordPath: string } };
    expect(env.data.dispatchRecordPath).toBeTruthy();

    // heartbeat --status done should succeed without spawning release
    const heartbeat = runCli([
      'sub-agent', 'heartbeat',
      '--record', env.data.dispatchRecordPath,
      '--status', 'done',
      '--progress', '100',
      '--project', project,
      '--json'
    ], project);
    expect(heartbeat.code).toBe(0);

    // The dispatch record still exists; no lease file was created
    const record = JSON.parse(readFileSync(env.data.dispatchRecordPath, 'utf8')) as { leaseId: string | null; status: string };
    expect(record.leaseId).toBeNull();
    expect(record.status).toBe('done');
    const leaseDir = join(project, '.peaks', '_runtime', sessionId, 'worktree-leases');
    expect(existsSync(leaseDir)).toBe(false);
  });
});
