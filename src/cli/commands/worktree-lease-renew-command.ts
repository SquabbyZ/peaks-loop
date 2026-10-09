/**
 * `peaks worktree renew` — extend an active lease's `expiresAt`.
 *
 * Extracted verbatim from `worktree-lease-commands.ts` (mechanical move of
 * the `.action()` body). The lease-file failures route through the shared
 * `loadLeaseOrStop`; the LEASE_NOT_RENEWABLE / INVALID_TTL guards, the
 * renewal write, the metric emit and the ok/fail envelopes are unchanged.
 */

import type { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { atomicWriteJson } from '../../services/ide/shared/atomic-json.js';
import { emitLeaseEvent } from '../../services/observability/observability-service.js';
import {
  leaseFilePath,
  renewLease,
  ttlForRole,
  type WorktreeLease
} from '../../services/worktree/worktree-lease.js';
import { loadLeaseOrStop } from './worktree-lease-load.js';
import { joinPathSession, resolveProjectRoot, resolveSessionId } from './worktree-lease-session.js';

const RENEW_DESCRIPTION =
  "Extend an active lease's `expiresAt` and persist it. Idempotent for already-active leases. " +
  'Default TTL uses `DEFAULT_TTL_BY_ROLE[<lease.role>]`; pass --ttl <ms> to override.';

const RENEW_MISSING_HINTS: string[] = [
  'Run `peaks worktree list` to inspect active leases.',
  'For a never-spawned lease, this is a no-op.'
];

const RENEW_INVALID_HINTS: string[] = [
  'Delete the malformed lease file manually and re-spawn.',
  'For security, renew never fails open on a malformed lease.'
];

type RenewOptions = {
  leaseId: string;
  ttl?: string;
  session?: string;
  project?: string;
  json?: boolean;
};

function printRenewNotRenewable(io: ProgramIO, options: RenewOptions, lease: WorktreeLease): void {
  printResult(
    io,
    fail(
      'worktree.renew',
      'LEASE_NOT_RENEWABLE',
      `lease is in status '${lease.status}'; only active/expired leases may be renewed`,
      { leaseId: lease.leaseId, status: lease.status },
      [
        'Released leases cannot be renewed. Run `peaks worktree spawn` to start a new lease.',
        'Gc-marked leases are terminal — re-spawn.'
      ]
    ),
    options.json
  );
  process.exitCode = 1;
}

function printRenewInvalidTtl(io: ProgramIO, options: RenewOptions): void {
  printResult(
    io,
    fail(
      'worktree.renew',
      'INVALID_TTL',
      '--ttl must be a positive integer (ms)',
      { ttl: options.ttl },
      ['Re-run with --ttl 1800000 (30 min) or omit to use role default.']
    ),
    options.json
  );
  process.exitCode = 1;
}

function printRenewOk(
  io: ProgramIO,
  options: RenewOptions,
  ctx: {
    lease: WorktreeLease;
    renewed: WorktreeLease;
    sessionId: string;
    projectRoot: string;
    ttlMs: number;
  }
): void {
  const { lease, renewed, sessionId, projectRoot, ttlMs } = ctx;
  printResult(
    io,
    ok(
      'worktree.renew',
      { lease: renewed, sessionId, projectRoot, ttlMs, previousExpiresAt: lease.expiresAt },
      [],
      [
        `Lease ${renewed.leaseId} renewed; new expiresAt: ${new Date(renewed.expiresAt).toISOString()}.`,
        `Branch ${renewed.branch} at ${renewed.path} remains intact (no ` +
          '`git worktree` operation was performed — the worktree was always there).'
      ]
    ),
    options.json
  );
}

function printRenewFailed(
  io: ProgramIO,
  options: RenewOptions,
  err: unknown,
  sessionId: string
): void {
  printResult(
    io,
    fail(
      'worktree.renew',
      'RENEW_FAILED',
      getErrorMessage(err),
      { leaseId: options.leaseId, sessionId },
      ['Re-run after fixing the failure (see cause in the error message).']
    ),
    options.json
  );
  process.exitCode = 1;
}

function runRenew(options: RenewOptions, io: ProgramIO): void {
  const projectRoot = resolveProjectRoot(options);
  const sessionId = resolveSessionId(options, projectRoot);
  try {
    const file = leaseFilePath(joinPathSession(projectRoot, sessionId), options.leaseId);
    const loaded = loadLeaseOrStop(io, options, {
      command: 'worktree.renew',
      file,
      hints: { missing: RENEW_MISSING_HINTS, invalid: RENEW_INVALID_HINTS }
    });
    if (loaded.stop) {
      process.exitCode = 1;
      return;
    }
    const lease = loaded.lease;

    if (lease.status === 'released' || lease.status === 'gc') {
      printRenewNotRenewable(io, options, lease);
      return;
    }

    const now = Date.now();
    const ttlMs =
      options.ttl === undefined ? ttlForRole(lease.role) : Number.parseInt(options.ttl, 10);
    if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
      printRenewInvalidTtl(io, options);
      return;
    }
    const renewed = renewLease(lease, now + ttlMs);
    atomicWriteJson(file, renewed);
    // Part 4.A: emit renew metric.
    emitLeaseEvent({
      sessionId,
      projectRoot,
      kind: 'renew',
      leaseId: renewed.leaseId,
      rid: renewed.rid,
      role: renewed.role
    });
    printRenewOk(io, options, { lease, renewed, sessionId, projectRoot, ttlMs });
  } catch (err) {
    printRenewFailed(io, options, err, sessionId);
  }
}

export function registerWorktreeLeaseRenewCommand(auth: Command, io: ProgramIO): void {
  addJsonOption(
    auth
      .command('renew')
      .description(RENEW_DESCRIPTION)
      .requiredOption('--lease-id <id>', 'lease id returned by `peaks worktree spawn`')
      .option('--ttl <ms>', 'time-to-live in ms from now (default: role-default)')
      .option('--session <sid>', 'override session id')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: RenewOptions) => runRenew(options, io));
}
