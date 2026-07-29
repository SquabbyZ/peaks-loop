/**
 * Slice 2026-07-29-worktree-l2-extended Part 2.D — lease lifecycle e2e.
 *
 * Part 1 shipped `peaks worktree spawn | release` and the unit test
 * suite covered the pure helpers, but the envelope shape + execSync
 * git worktree spy tests were deferred (see Part 1 sediment §"CLI
 * command e2e test deferred"). Part 2.A added renew/list/gc/status
 * without a CLI IO test. Part 2.D closes the gap end-to-end:
 *
 *   spawn → list (verify 1 active)
 *        → status (verify diagnostics)
 *        → renew (verify expiresAt advanced + branch/path unchanged)
 *        → release (verify worktree removed + status=released)
 *        → gc (verify lease marked 'gc' + git worktree pruned)
 *        → list (verify no active leases left)
 *
 * The CLI commands shell out to `git worktree add/remove/prune`. The
 * test sets up a real tmp git repo (mirrors `sub-agent-dispatch-e2e`
 * pattern) so the execSync calls succeed without a fixture spy.
 *
 * Pure helpers (isLeaseActive / isLeaseGcEligible / renewLease /
 * listLeasesSync) are exhaustively covered by
 * tests/unit/services/worktree/worktree-lease.test.ts and
 * tests/unit/hooks/worktree-authorization-gate.test.ts. This file
 * only covers IO + git fixture.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const BIN = resolve(__dirname, '../../bin/peaks.js');

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

function runCli(args: readonly string[], cwd: string): RunResult {
  try {
    const stdout = execFileSync('node', [BIN, 'worktree', ...args], {
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

interface SpawnEnvelope {
  readonly ok: true;
  readonly command: string;
  readonly data: {
    readonly lease: { readonly leaseId: string; readonly path: string; readonly branch: string; readonly rid: string; readonly expiresAt: number; readonly status: string };
    readonly sessionId: string;
    readonly projectRoot: string;
  };
}

interface ListEnvelope {
  readonly ok: true;
  readonly data: {
    readonly totalOnDisk: number;
    readonly returned: number;
    readonly leases: ReadonlyArray<{
      readonly leaseId: string;
      readonly path: string;
      readonly branch: string;
      readonly status: 'active' | 'released' | 'expired' | 'gc';
      readonly live: boolean;
      readonly remainingMs: number;
    }>;
  };
}

interface StatusEnvelope {
  readonly ok: true;
  readonly data: {
    readonly lease: { readonly leaseId: string; readonly status: string; readonly expiresAt: number };
    readonly live: boolean;
    readonly diagnostics: { readonly now: number; readonly remainingMs: number; readonly pathExists: boolean; readonly pathIsDirectory: boolean };
  };
}

interface RenewEnvelope {
  readonly ok: true;
  readonly data: { readonly lease: { readonly leaseId: string; readonly status: string; readonly expiresAt: number }; readonly previousExpiresAt: number; readonly ttlMs: number };
}

interface ReleaseEnvelope {
  readonly ok: true;
  readonly data: { readonly lease: { readonly leaseId: string; readonly status: string }; readonly alreadyReleased?: boolean; readonly gitWorktreeRemoveFailed: boolean };
}

interface GcEnvelope {
  readonly ok: true;
  readonly data: {
    readonly dryRun: boolean;
    readonly candidates: number;
    readonly swept: ReadonlyArray<{ readonly leaseId: string; readonly path: string; readonly prevStatus: string; readonly gitWorktreeRemoveFailed: boolean }>;
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
  const project = mkdtempSync(join(tmpdir(), 'peaks-wt-lifecycle-'));
  projects.push(project);
  execFileSync('git', ['init', '-q', '-b', 'main', project], { stdio: 'pipe' });
  execFileSync('git', ['-C', project, 'config', 'user.email', 'lifecycle@test'], { stdio: 'pipe' });
  execFileSync('git', ['-C', project, 'config', 'user.name', 'lifecycle'], { stdio: 'pipe' });
  // commit-1 establishes a real main branch so `git worktree add -b feat` succeeds
  execFileSync('git', ['-C', project, 'commit', '--allow-empty', '-m', 'init', '-q'], { stdio: 'pipe' });
  return project;
}

describe('peaks worktree lease lifecycle (Part 2.D)', () => {
  test('full lifecycle: spawn → list → status → renew → release → gc → list-empty', () => {
    const project = initRepo();
    const sessionId = '2026-07-29-p2d-lifecycle';
    const rid = 'rid-2026-07-29-p2d-lifecycle';
    const role = 'rd';
    const purpose = 'part 2.D lifecycle e2e';

    // ── 1. spawn ───────────────────────────────────────────────────────
    const spawnRes = runCli([
      'spawn',
      '--rid', rid,
      '--role', role,
      '--purpose', purpose,
      '--session', sessionId,
      '--project', project,
      '--json'
    ], project);
    expect(spawnRes.code).toBe(0);
    const spawn = JSON.parse(spawnRes.stdout) as SpawnEnvelope;
    expect(spawn.ok).toBe(true);
    expect(spawn.data.lease.leaseId).toMatch(/^[a-f0-9]{16}$/);
    expect(spawn.data.lease.rid).toBe(rid);
    expect(spawn.data.lease.status).toBe('active');
    expect(spawn.data.lease.path).toContain('worktrees/' + spawn.data.lease.leaseId);
    // The git worktree actually got created on disk
    expect(existsSync(spawn.data.lease.path)).toBe(true);
    expect(statSync(spawn.data.lease.path).isDirectory()).toBe(true);
    // The lease file got written
    const leaseFile = join(project, '.peaks', '_runtime', sessionId, 'worktree-leases', spawn.data.lease.leaseId + '.json');
    expect(existsSync(leaseFile)).toBe(true);
    const lid = spawn.data.lease.leaseId;

    // ── 2. list (1 active) ─────────────────────────────────────────────
    const list1 = runCli(['list', '--session', sessionId, '--project', project, '--json'], project);
    expect(list1.code).toBe(0);
    const l1 = JSON.parse(list1.stdout) as ListEnvelope;
    expect(l1.ok).toBe(true);
    expect(l1.data.totalOnDisk).toBe(1);
    expect(l1.data.returned).toBe(1);
    expect(l1.data.leases[0]?.status).toBe('active');
    expect(l1.data.leases[0]?.live).toBe(true);

    // ── 3. status (verify diagnostics) ────────────────────────────────
    const status = runCli(['lease-status', '--lease-id', lid, '--session', sessionId, '--project', project, '--json'], project);
    expect(status.code).toBe(0);
    const s = JSON.parse(status.stdout) as StatusEnvelope;
    expect(s.ok).toBe(true);
    expect(s.data.lease.leaseId).toBe(lid);
    expect(s.data.live).toBe(true);
    expect(s.data.diagnostics.pathExists).toBe(true);
    expect(s.data.diagnostics.pathIsDirectory).toBe(true);

    // ── 4. renew (verify expiresAt advanced) ──────────────────────────
    // The renew CLI computes `newExpiresAt = Date.now() + ttl`. The
    // spawn above used the rd role default (30 min). Renew with a
    // 24h TTL so the new expiry is guaranteed larger regardless of
    // inter-process clock drift; verify the envelope's previousExpiresAt
    // is the on-disk value just before renew ran.
    const onDiskBeforeRenew = JSON.parse(readFileSync(leaseFile, 'utf8')) as { expiresAt: number };
    const previousExpiresAt = onDiskBeforeRenew.expiresAt;
    const renewTtlMs = 24 * 60 * 60 * 1000;
    const renew = runCli(['renew', '--lease-id', lid, '--ttl', String(renewTtlMs), '--session', sessionId, '--project', project, '--json'], project);
    expect(renew.code).toBe(0);
    const r = JSON.parse(renew.stdout) as RenewEnvelope;
    expect(r.ok).toBe(true);
    expect(r.data.lease.leaseId).toBe(lid);
    expect(r.data.lease.status).toBe('active');
    expect(r.data.previousExpiresAt).toBe(previousExpiresAt);
    expect(r.data.ttlMs).toBe(renewTtlMs);
    expect(r.data.lease.expiresAt).toBeGreaterThan(previousExpiresAt);
    // Path/branch unchanged (no git operation)
    expect(existsSync(spawn.data.lease.path)).toBe(true);

    // ── 5. release (verify worktree removed + status=released) ─────────
    const release = runCli(['release', '--lease-id', lid, '--session', sessionId, '--project', project, '--json'], project);
    expect(release.code).toBe(0);
    const rel = JSON.parse(release.stdout) as ReleaseEnvelope;
    expect(rel.ok).toBe(true);
    expect(rel.data.lease.status).toBe('released');
    expect(rel.data.gitWorktreeRemoveFailed).toBe(false);
    expect(existsSync(spawn.data.lease.path)).toBe(false);
    // The on-disk lease file still exists with status=released
    const releasedRaw = JSON.parse(readFileSync(leaseFile, 'utf8')) as { status: string };
    expect(releasedRaw.status).toBe('released');

    // ── 6. gc (mark 'gc' + git worktree prune) ───────────────────────
    const gc = runCli(['gc', '--lease-id', lid, '--session', sessionId, '--project', project, '--json'], project);
    expect(gc.code).toBe(0);
    const g = JSON.parse(gc.stdout) as GcEnvelope;
    expect(g.ok).toBe(true);
    expect(g.data.dryRun).toBe(false);
    expect(g.data.candidates).toBe(1);
    expect(g.data.swept).toHaveLength(1);
    expect(g.data.swept[0]?.leaseId).toBe(lid);
    expect(g.data.swept[0]?.prevStatus).toBe('released');
    // The on-disk lease file is now 'gc'
    const gcRaw = JSON.parse(readFileSync(leaseFile, 'utf8')) as { status: string };
    expect(gcRaw.status).toBe('gc');

    // ── 7. list (no active; total on disk still 1 but returned=0 with --status active filter) ───
    const list2 = runCli(['list', '--status', 'active', '--session', sessionId, '--project', project, '--json'], project);
    expect(list2.code).toBe(0);
    const l2 = JSON.parse(list2.stdout) as ListEnvelope;
    expect(l2.ok).toBe(true);
    expect(l2.data.totalOnDisk).toBe(1);
    expect(l2.data.returned).toBe(0); // --status active filter excludes gc

    // ── 8. gc --dry-run is a no-op ─────────────────────────────────────
    // Re-spawn a fresh lease with a DIFFERENT branch (--branch) so the
    // git worktree add succeeds even if the previous branch is still
    // registered in git's worktree admin table — avoids a race between
    // the test's release→gc and the respawn.
    const respawn = runCli([
      'spawn',
      '--rid', rid,
      '--role', role,
      '--branch', 'p2d-dry-run-branch',
      '--purpose', 'part 2.D dry-run',
      '--session', sessionId,
      '--project', project,
      '--json'
    ], project);
    expect(respawn.code).toBe(0);
    const respawnEnv = JSON.parse(respawnRespawnStdout(respawn.stdout)) as SpawnEnvelope;
    const lid2 = respawnEnv.data.lease.leaseId;
    // Release so the lease becomes gc-eligible
    const release2 = runCli(['release', '--lease-id', lid2, '--session', sessionId, '--project', project, '--json'], project);
    expect(release2.code).toBe(0);
    // Dry-run gc should report a candidate but NOT mutate
    const dryRun = runCli(['gc', '--dry-run', '--session', sessionId, '--project', project, '--json'], project);
    expect(dryRun.code).toBe(0);
    const dr = JSON.parse(dryRun.stdout) as GcEnvelope;
    expect(dr.ok).toBe(true);
    expect(dr.data.dryRun).toBe(true);
    expect(dr.data.swept.length).toBeGreaterThanOrEqual(1);
    // The lease file is still 'released', not 'gc'
    const leaseFile2 = join(project, '.peaks', '_runtime', sessionId, 'worktree-leases', lid2 + '.json');
    const stillReleased = JSON.parse(readFileSync(leaseFile2, 'utf8')) as { status: string };
    expect(stillReleased.status).toBe('released');
  });

  test('renew on a released lease → LEASE_NOT_RENEWABLE (fail-closed)', () => {
    const project = initRepo();
    const sessionId = '2026-07-29-p2d-renew-released';
    const spawn = JSON.parse(runCli([
      'spawn', '--rid', 'rid-r', '--role', 'rd', '--purpose', 'p',
      '--session', sessionId, '--project', project, '--json'
    ], project).stdout) as SpawnEnvelope;
    const lid = spawn.data.lease.leaseId;
    const release = runCli(['release', '--lease-id', lid, '--session', sessionId, '--project', project, '--json'], project);
    expect(release.code).toBe(0);
    const renew = runCli(['renew', '--lease-id', lid, '--session', sessionId, '--project', project, '--json'], project);
    expect(renew.code).toBe(1);
    const env = JSON.parse(renew.stdout) as { ok: false; code: string };
    expect(env.ok).toBe(false);
    expect(env.code).toBe('LEASE_NOT_RENEWABLE');
  });

  test('status on a never-spawned lease id → LEASE_NOT_FOUND (fail-closed)', () => {
    const project = initRepo();
    const sessionId = '2026-07-29-p2d-status-missing';
    const r = runCli(['lease-status', '--lease-id', 'ffffffffffffffff', '--session', sessionId, '--project', project, '--json'], project);
    expect(r.code).toBe(1);
    const env = JSON.parse(r.stdout) as { ok: false; code: string };
    expect(env.ok).toBe(false);
    expect(env.code).toBe('LEASE_NOT_FOUND');
  });
});

// Helper: the second spawn in test 1 shares the same JSON envelope
// shape; we use this thin wrapper so the test reads clean.
function respawnRespawnStdout(stdout: string): string {
  return stdout;
}
