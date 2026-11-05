/**
 * `peaks worktree renew` — extend an active lease's `expiresAt`.
 *
 * The action body is `runRenew` from `peaks-loop-workspace-runtime`; this file
 * owns the host policy, the effects and the envelope. Every result kind is
 * mapped back onto the envelope/exit code it produced before the extraction
 * (LEASE_NOT_FOUND / LEASE_FILE_INVALID / LEASE_NOT_RENEWABLE / INVALID_TTL),
 * and the metric emit stays here.
 */

import type { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';
import { defaultStateRoot, runRenew, type WorktreeLease } from 'peaks-loop-workspace-runtime';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { emitLeaseEvent } from '../../services/observability/observability-service.js';
import { leaseEffects } from './worktree-lease-effects.js';
import { stopOnLeaseFileFailure } from './worktree-lease-load.js';
import { resolveProjectRoot, resolveSessionId } from './worktree-lease-session.js';

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

function runRenewAction(options: RenewOptions, io: ProgramIO): void {
  const projectRoot = resolveProjectRoot(options);
  const sessionId = resolveSessionId(options, projectRoot);
  try {
    const result = runRenew(
      {
        projectRoot,
        stateRoot: defaultStateRoot(projectRoot),
        sessionId,
        leaseId: options.leaseId,
        // `exactOptionalPropertyTypes`: absent means the role's default TTL.
        ...(options.ttl === undefined ? {} : { ttlMs: Number.parseInt(options.ttl, 10) })
      },
      leaseEffects(Date.now())
    );

    switch (result.kind) {
      case 'lease-not-found':
      case 'lease-invalid':
        stopOnLeaseFileFailure(
          io,
          options,
          {
            command: 'worktree.renew',
            hints: { missing: RENEW_MISSING_HINTS, invalid: RENEW_INVALID_HINTS }
          },
          result
        );
        return;
      case 'not-renewable':
        printRenewNotRenewable(io, options, result.lease);
        return;
      case 'invalid-ttl':
        printRenewInvalidTtl(io, options);
        return;
      case 'ok':
        break;
    }

    const { lease: renewed, previous: lease, ttlMs } = result;
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
  ).action((options: RenewOptions) => runRenewAction(options, io));
}
