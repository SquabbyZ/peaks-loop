/**
 * `peaks worktree gc` — sweep released/expired leases.
 *
 * Extracted verbatim from `worktree-lease-commands.ts` (mechanical move of
 * the `.action()` body). The per-lease sweep is now `sweepLease`; the
 * `--lease-id` / `--dry-run` semantics, the expired-active transition, the
 * best-effort git removal + prune, the per-lease metric emit and the
 * ok/fail envelopes are unchanged.
 */

import type { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { atomicWriteJson } from '../../services/ide/shared/atomic-json.js';
import { emitLeaseEvent } from '../../services/observability/observability-service.js';
import {
  isLeaseGcEligible,
  leaseFilePath,
  markExpired,
  markGc,
  type LeaseReadError,
  type WorktreeLease
} from '../../services/worktree/worktree-lease.js';
import { pruneWorktreesBestEffort, removeWorktreeBestEffort } from './worktree-lease-git.js';
import { loadLeaseStore, malformedLeaseWarnings } from './worktree-lease-store.js';
import { joinPathSession, resolveProjectRoot, resolveSessionId } from './worktree-lease-session.js';

const GC_DESCRIPTION =
  "Sweep released/expired leases: remove their git worktree (if still attached), prune git's " +
  'worktree references, and mark the lease as "gc". With --lease-id <id>, only that lease is ' +
  "considered. With --dry-run, report what would be gc'd without mutating. Expired-active " +
  'leases (status=active but past expiresAt) are eligible — they are first marked "expired" ' +
  'then their worktree is removed.';

const GC_LEASE_ID_DESCRIPTION = 'only consider this specific lease';
const GC_DRY_RUN_DESCRIPTION = "report what would be gc'd without mutating";

type GcOptions = {
  /** Only gc one specific lease id (default: sweep all eligible). */
  leaseId?: string;
  /** Dry-run: report what would be gc'd without mutating. */
  dryRun?: boolean;
  session?: string;
  project?: string;
  json?: boolean;
};

interface SweptLease {
  leaseId: string;
  path: string;
  prevStatus: WorktreeLease['status'];
  gitWorktreeRemoveFailed: boolean;
}

interface SweepContext {
  lease: WorktreeLease;
  dryRun: boolean;
  now: number;
  projectRoot: string;
  sessionId: string;
}

function sweepLease(ctx: SweepContext): SweptLease {
  const { lease, dryRun, now, projectRoot, sessionId } = ctx;
  let prevStatus: WorktreeLease['status'] = lease.status;
  let updated: WorktreeLease = lease;
  // If the lease is still marked active but past expiresAt, transition to expired first.
  if (lease.status === 'active' && lease.expiresAt <= now) {
    updated = markExpired(lease);
    prevStatus = 'active';
  }
  if (dryRun) {
    return {
      leaseId: lease.leaseId,
      path: lease.path,
      prevStatus,
      gitWorktreeRemoveFailed: false
    };
  }
  // `git worktree remove --force` is best-effort — if the path is
  // already gone we still mark the lease gc.
  const gitWorktreeRemoveFailed = removeWorktreeBestEffort(projectRoot, updated.path);
  pruneWorktreesBestEffort(projectRoot);
  const finalLease = markGc(updated);
  atomicWriteJson(
    leaseFilePath(joinPathSession(projectRoot, sessionId), lease.leaseId),
    finalLease
  );
  // Part 4.A: emit gc metric (per swept lease).
  emitLeaseEvent({
    sessionId,
    projectRoot,
    kind: 'gc',
    leaseId: lease.leaseId,
    rid: lease.rid,
    role: lease.role
  });
  return { leaseId: lease.leaseId, path: lease.path, prevStatus, gitWorktreeRemoveFailed };
}

function printGcStoreMissing(
  io: ProgramIO,
  options: GcOptions,
  ctx: { sessionId: string; projectRoot: string; storeDir: string }
): void {
  const { sessionId, projectRoot, storeDir } = ctx;
  printResult(
    io,
    ok(
      'worktree.gc',
      { sessionId, projectRoot, swept: 0, storeMissing: true },
      [],
      [`No lease store at ${storeDir}; nothing to gc.`]
    ),
    options.json
  );
}

function printGcOk(
  io: ProgramIO,
  options: GcOptions,
  ctx: {
    sessionId: string;
    projectRoot: string;
    dryRun: boolean;
    candidates: number;
    swept: SweptLease[];
    errors: ReadonlyArray<LeaseReadError>;
  }
): void {
  const { sessionId, projectRoot, dryRun, candidates, swept, errors } = ctx;
  printResult(
    io,
    ok(
      'worktree.gc',
      { sessionId, projectRoot, dryRun, candidates, swept, errors },
      malformedLeaseWarnings(errors),
      [
        dryRun
          ? `[dry-run] Would gc ${swept.length} lease(s); no filesystem changes were made.`
          : `Gc'd ${swept.length} lease(s).`,
        'For per-lease detail, run `peaks worktree status --lease-id <id>`.'
      ]
    ),
    options.json
  );
}

function printGcFailed(io: ProgramIO, options: GcOptions, err: unknown, sessionId: string): void {
  printResult(
    io,
    fail('worktree.gc', 'GC_FAILED', getErrorMessage(err), { sessionId }, [
      'Re-run after fixing the failure (see cause in the error message).'
    ]),
    options.json
  );
  process.exitCode = 1;
}

function runGc(options: GcOptions, io: ProgramIO): void {
  const projectRoot = resolveProjectRoot(options);
  const sessionId = resolveSessionId(options, projectRoot);
  try {
    const { storeDir, result } = loadLeaseStore(projectRoot, sessionId);
    if (result.kind === 'store-missing') {
      printGcStoreMissing(io, options, { sessionId, projectRoot, storeDir });
      return;
    }
    const now = Date.now();
    const candidates = result.leases
      .filter((l) => (options.leaseId ? l.leaseId === options.leaseId : true))
      .filter((l) => isLeaseGcEligible(l, now));

    const dryRun = options.dryRun === true;
    const swept: SweptLease[] = [];
    for (const lease of candidates) {
      swept.push(sweepLease({ lease, dryRun, now, projectRoot, sessionId }));
    }

    printGcOk(io, options, {
      sessionId,
      projectRoot,
      dryRun,
      candidates: candidates.length,
      swept,
      errors: result.errors
    });
  } catch (err) {
    printGcFailed(io, options, err, sessionId);
  }
}

export function registerWorktreeLeaseGcCommand(auth: Command, io: ProgramIO): void {
  addJsonOption(
    auth
      .command('gc')
      .description(GC_DESCRIPTION)
      .option('--lease-id <id>', GC_LEASE_ID_DESCRIPTION)
      .option('--dry-run', GC_DRY_RUN_DESCRIPTION)
      .option('--session <sid>', 'override session id')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: GcOptions) => runGc(options, io));
}
