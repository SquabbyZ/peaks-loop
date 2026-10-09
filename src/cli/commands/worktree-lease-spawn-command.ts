/**
 * `peaks worktree spawn` — write a lease and run `git worktree add`.
 *
 * Extracted verbatim from `worktree-lease-commands.ts` (mechanical move of
 * the `.action()` body plus its two local helpers). The command name,
 * every option and its help text, the ok/fail envelopes and the
 * `process.exitCode = 1` on failure are unchanged.
 */

import type { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';
import { execSync } from 'node:child_process';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { atomicWriteJson } from '../../services/ide/shared/atomic-json.js';
import { emitLeaseEvent } from '../../services/observability/observability-service.js';
import {
  finalizeLease,
  generateLeaseId,
  leaseFilePath,
  ttlForRole,
  worktreePath,
  type WorktreeLease
} from '../../services/worktree/worktree-lease.js';
import { joinPathSession, resolveProjectRoot, resolveSessionId } from './worktree-lease-session.js';

const SPAWN_DESCRIPTION =
  `Spawn a worktree under .peaks/_runtime/<sid>/worktrees/<leaseId>/ with a managed lease. ` +
  `The lease is the source of truth for the L2 hook gate (Part 2 of this slice); ` +
  `until the hook integration ships, sub-agents may still invoke raw \`git worktree add\` ` +
  `with a current \`peaks worktree auth grant\` token. Default TTL is role-aware ` +
  `(rd=30m / qa=15m / ui=1h); pass --ttl <ms> to override.`;

const SPAWN_TTL_DESCRIPTION = `time-to-live in ms (default role-aware; override with positive number)`;

// Branch names must be safe for git ref-format; the cap keeps a pathological
// rid from producing an unusable ref.
const MAX_BRANCH_NAME_LENGTH = 80;

type SpawnOptions = {
  rid: string;
  role: string;
  purpose: string;
  ttl?: string;
  branch?: string;
  session?: string;
  project?: string;
  json?: boolean;
};

function resolveTtlMs(raw: string | undefined, role: string): number {
  if (typeof raw !== 'string' || raw.length === 0) return ttlForRole(role);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return ttlForRole(role);
  return parsed;
}

function deriveBranch(rid: string): string {
  // Branch names must be safe for git ref-format. Strip leading
  // `rid-` if present and replace any non-safe chars with `-`.
  return rid.replace(/[^A-Za-z0-9._/-]/g, '-').slice(0, MAX_BRANCH_NAME_LENGTH);
}

function printSpawnOk(
  io: ProgramIO,
  options: SpawnOptions,
  ctx: {
    lease: WorktreeLease;
    sessionId: string;
    projectRoot: string;
    ttlMs: number;
    wtPath: string;
    branch: string;
  }
): void {
  const { lease, sessionId, projectRoot, ttlMs, wtPath, branch } = ctx;
  printResult(
    io,
    ok(
      'worktree.spawn',
      {
        lease,
        sessionId,
        projectRoot,
        ttlMs,
        nextActions: [
          `Worktree path: ${wtPath}`,
          `Branch: ${branch}`,
          `Lease expires at: ${new Date(lease.expiresAt).toISOString()}`,
          'Run `peaks worktree release --lease-id <leaseId>` when done',
          'Hook integration (lease-aware gate) ships in Part 2'
        ]
      },
      [],
      []
    ),
    options.json
  );
}

function printSpawnFailed(
  io: ProgramIO,
  options: SpawnOptions,
  error: unknown,
  sessionId: string
): void {
  printResult(
    io,
    fail(
      'worktree.spawn',
      'SPAWN_FAILED',
      getErrorMessage(error),
      { rid: options.rid, role: options.role, sessionId },
      [
        'Verify `git worktree add` succeeded (output above).',
        'If the lease file was NOT written, retry; the lease directory is .peaks/_runtime/<sid>/worktree-leases/.',
        'For an existing branch, pass --branch <name> explicitly (the spawn refuses to overwrite an active branch).'
      ]
    ),
    options.json
  );
  process.exitCode = 1;
}

function runSpawn(options: SpawnOptions, io: ProgramIO): void {
  const projectRoot = resolveProjectRoot(options);
  const sessionId = resolveSessionId(options, projectRoot);
  try {
    const leaseId = generateLeaseId();
    const now = Date.now();
    const ttlMs = resolveTtlMs(options.ttl, options.role);
    const branch = options.branch ?? deriveBranch(options.rid);
    const wtPath = worktreePath(joinPathSession(projectRoot, sessionId), leaseId);
    const lease = finalizeLease({
      leaseId,
      rid: options.rid,
      role: options.role,
      path: wtPath,
      branch,
      createdAt: now,
      expiresAt: now + ttlMs,
      purpose: options.purpose
    });

    // Run `git worktree add` from the project root. The PreToolUse hook
    // (Part 2 of this slice) will consult the lease file we just wrote
    // and authorize this very `git worktree add`; for Part 1 we still
    // require a current `peaks worktree auth grant` token to remain
    // consistent with the slice-027 hard gate contract.
    execSync(`git worktree add "${wtPath}" -b "${branch}"`, {
      cwd: projectRoot,
      stdio: 'pipe',
      encoding: 'utf8',
      windowsHide: true
    });

    atomicWriteJson(leaseFilePath(joinPathSession(projectRoot, sessionId), leaseId), lease);
    // Part 4.A: emit spawn metric (fire-and-forget; never blocks).
    emitLeaseEvent({
      sessionId,
      projectRoot,
      kind: 'spawn',
      leaseId,
      rid: options.rid,
      role: options.role
    });

    printSpawnOk(io, options, { lease, sessionId, projectRoot, ttlMs, wtPath, branch });
  } catch (error: unknown) {
    printSpawnFailed(io, options, error, sessionId);
  }
}

export function registerWorktreeLeaseSpawnCommand(auth: Command, io: ProgramIO): void {
  addJsonOption(
    auth
      .command('spawn')
      .description(SPAWN_DESCRIPTION)
      .requiredOption('--rid <rid>', 'peaks request id the lease is associated with')
      .requiredOption('--role <role>', 'sub-agent role (rd | qa | ui | sc | prd | general-purpose)')
      .requiredOption('--purpose <text>', 'why this worktree was spawned (audit log)')
      .option('--ttl <ms>', SPAWN_TTL_DESCRIPTION)
      .option('--branch <name>', 'git branch name (default: derived from rid)')
      .option('--session <sid>', 'override session id')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: SpawnOptions) => runSpawn(options, io));
}
