/**
 * `peaks worktree spawn` — write a lease and run `git worktree add`.
 *
 * The action body is `runSpawn` from `peaks-loop-workspace-runtime`; this file
 * owns the host policy (project root, session id, TTL parsing, `Date.now()`),
 * the effects (`./worktree-lease-effects.ts`) and the envelope. The command
 * name, every option and its help text, the ok/fail envelopes and the
 * `process.exitCode = 1` on failure are unchanged.
 */

import type { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';
import {
  defaultStateRoot,
  runSpawn,
  ttlForRole,
  type WorktreeLease
} from 'peaks-loop-workspace-runtime';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { emitLeaseEvent } from '../../services/observability/observability-service.js';
import { leaseEffects } from './worktree-lease-effects.js';
import { resolveProjectRoot, resolveSessionId } from './worktree-lease-session.js';

const SPAWN_DESCRIPTION =
  `Spawn a worktree under .peaks/_runtime/<sid>/worktrees/<leaseId>/ with a managed lease. ` +
  `The lease is the source of truth for the L2 hook gate (Part 2 of this slice); ` +
  `until the hook integration ships, sub-agents may still invoke raw \`git worktree add\` ` +
  `with a current \`peaks worktree auth grant\` token. Default TTL is role-aware ` +
  `(rd=30m / qa=15m / ui=1h); pass --ttl <ms> to override.`;

const SPAWN_TTL_DESCRIPTION = `time-to-live in ms (default role-aware; override with positive number)`;

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
  error: string,
  sessionId: string
): void {
  printResult(
    io,
    fail(
      'worktree.spawn',
      'SPAWN_FAILED',
      error,
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

function runSpawnAction(options: SpawnOptions, io: ProgramIO): void {
  const projectRoot = resolveProjectRoot(options);
  const sessionId = resolveSessionId(options, projectRoot);
  try {
    // `runSpawn` runs `git worktree add` first and writes the lease only once
    // it succeeds, so a failed add never leaves a lease pointing at a
    // worktree that does not exist.
    const result = runSpawn(
      {
        projectRoot,
        stateRoot: defaultStateRoot(projectRoot),
        sessionId,
        rid: options.rid,
        role: options.role,
        purpose: options.purpose,
        ttlMs: resolveTtlMs(options.ttl, options.role),
        // `exactOptionalPropertyTypes`: absent means "derive from rid", so the
        // key is omitted rather than set to undefined.
        ...(options.branch === undefined ? {} : { branch: options.branch })
      },
      leaseEffects(Date.now())
    );
    if (result.kind === 'failed') {
      printSpawnFailed(io, options, result.error, sessionId);
      return;
    }
    const { lease, ttlMs } = result;
    // Part 4.A: emit spawn metric (fire-and-forget; never blocks).
    emitLeaseEvent({
      sessionId,
      projectRoot,
      kind: 'spawn',
      leaseId: lease.leaseId,
      rid: options.rid,
      role: options.role
    });

    printSpawnOk(io, options, {
      lease,
      sessionId,
      projectRoot,
      ttlMs,
      wtPath: lease.path,
      branch: lease.branch
    });
  } catch (error: unknown) {
    printSpawnFailed(io, options, getErrorMessage(error), sessionId);
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
  ).action((options: SpawnOptions) => runSpawnAction(options, io));
}
