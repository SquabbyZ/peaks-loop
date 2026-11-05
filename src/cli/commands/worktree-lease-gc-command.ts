/**
 * `peaks worktree gc` — sweep released/expired leases.
 *
 * The sweep is `runGc` from `peaks-loop-workspace-runtime`; this file owns the
 * host policy, the effects, the per-lease metric emit and the envelope. The
 * `--lease-id` / `--dry-run` semantics, the expired-active transition, the
 * best-effort git removal + prune and the ok/fail envelopes are unchanged.
 */

import type { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';
import {
  defaultStateRoot,
  runGc,
  type GcResult,
  type LeaseReadError,
  type WorktreeLeaseStatus
} from 'peaks-loop-workspace-runtime';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { emitLeaseEvent } from '../../services/observability/observability-service.js';
import { leaseEffects } from './worktree-lease-effects.js';
import { loadLeaseStore, malformedLeaseWarnings } from './worktree-lease-store.js';
import { resolveProjectRoot, resolveSessionId } from './worktree-lease-session.js';

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
  prevStatus: WorktreeLeaseStatus;
  gitWorktreeRemoveFailed: boolean;
}

/** The two lease fields the gc metric row carries. */
interface LeaseIdentity {
  rid: string;
  role: string;
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
        'For per-lease detail, run `peaks worktree lease-status --lease-id <id>`.'
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

/**
 * The rid/role the gc metric row needs, keyed by lease id. The package's sweep
 * result carries the id and path but not the lease itself, so the store is
 * read once more here — the single directory scan this command made before.
 */
function leaseIdentity(projectRoot: string, sessionId: string): Map<string, LeaseIdentity> {
  const listed = loadLeaseStore(projectRoot, sessionId);
  const leases = listed.result.kind === 'ok' ? listed.result.leases : [];
  return new Map(leases.map((lease) => [lease.leaseId, { rid: lease.rid, role: lease.role }]));
}

/** Part 4.A: one gc metric per swept lease; a dry run emits nothing. */
function emitGcMetrics(
  result: GcResult,
  ctx: { projectRoot: string; sessionId: string; identity: Map<string, LeaseIdentity> }
): void {
  if (result.kind !== 'ok' || result.dryRun) return;
  for (const entry of result.swept) {
    const identity = ctx.identity.get(entry.leaseId);
    // A swept lease came from the store just read, so a miss only happens if
    // the store changed underneath us; never emit a row with an invented rid.
    if (identity === undefined) continue;
    emitLeaseEvent({
      sessionId: ctx.sessionId,
      projectRoot: ctx.projectRoot,
      kind: 'gc',
      leaseId: entry.leaseId,
      rid: identity.rid,
      role: identity.role
    });
  }
}

function runGcAction(options: GcOptions, io: ProgramIO): void {
  const projectRoot = resolveProjectRoot(options);
  const sessionId = resolveSessionId(options, projectRoot);
  try {
    // Read BEFORE the sweep, as before: a store that cannot be read fails the
    // command without having mutated anything.
    const identity = leaseIdentity(projectRoot, sessionId);
    const result = runGc(
      {
        projectRoot,
        stateRoot: defaultStateRoot(projectRoot),
        sessionId,
        // A falsy `--lease-id` means "every lease", as before.
        ...(options.leaseId ? { leaseId: options.leaseId } : {}),
        dryRun: options.dryRun === true
      },
      leaseEffects(Date.now())
    );
    if (result.kind === 'store-missing') {
      printGcStoreMissing(io, options, { sessionId, projectRoot, storeDir: result.storeDir });
      return;
    }

    emitGcMetrics(result, { projectRoot, sessionId, identity });

    printGcOk(io, options, {
      sessionId,
      projectRoot,
      dryRun: result.dryRun,
      candidates: result.candidates,
      swept: result.swept.map((entry) => ({
        leaseId: entry.leaseId,
        path: entry.path,
        prevStatus: entry.previousStatus,
        gitWorktreeRemoveFailed: entry.gitWorktreeRemoveFailed
      })),
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
  ).action((options: GcOptions) => runGcAction(options, io));
}
