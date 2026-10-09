/**
 * `peaks worktree lease-status` — show one lease in detail.
 *
 * Extracted verbatim from `worktree-lease-commands.ts` (mechanical move of
 * the `.action()` body). The lease-file failures route through the shared
 * `loadLeaseOrStop`; the computed `live` flag, the on-disk path
 * diagnostics and the ok/fail envelopes are unchanged.
 */

import type { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';
import { existsSync, statSync } from 'node:fs';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  isLeaseActive,
  leaseFilePath,
  type WorktreeLease
} from '../../services/worktree/worktree-lease.js';
import { loadLeaseOrStop } from './worktree-lease-load.js';
import { joinPathSession, resolveProjectRoot, resolveSessionId } from './worktree-lease-session.js';

const LEASE_STATUS_DESCRIPTION =
  'Show one lease in detail: full lease record + computed `live` flag (active AND not past ' +
  'expiry) + path/branch/path-exists-on-disk diagnostics. Use this when triaging why a ' +
  'sub-agent cannot write to a worktree.';

const STATUS_MISSING_HINTS: string[] = ['Run `peaks worktree list` to inspect available leases.'];

const STATUS_INVALID_HINTS: string[] = ['Delete the malformed lease file manually and re-spawn.'];

type LeaseStatusOptions = {
  leaseId: string;
  session?: string;
  project?: string;
  json?: boolean;
};

/** Whether the lease path is present on disk and is a directory. */
function inspectLeasePath(leasePath: string): { pathExists: boolean; pathIsDirectory: boolean } {
  const pathExists = existsSync(leasePath);
  if (!pathExists) return { pathExists, pathIsDirectory: false };
  try {
    return { pathExists, pathIsDirectory: statSync(leasePath).isDirectory() };
  } catch {
    return { pathExists, pathIsDirectory: false };
  }
}

function printLeaseStatusOk(
  io: ProgramIO,
  options: LeaseStatusOptions,
  ctx: { lease: WorktreeLease; sessionId: string; projectRoot: string }
): void {
  const { lease, sessionId, projectRoot } = ctx;
  const now = Date.now();
  const { pathExists, pathIsDirectory } = inspectLeasePath(lease.path);
  const live = isLeaseActive(lease, now);
  printResult(
    io,
    ok(
      'worktree.lease-status',
      {
        sessionId,
        projectRoot,
        file: '.peaks/_runtime/' + sessionId + '/worktree-leases/' + lease.leaseId + '.json',
        lease,
        live,
        diagnostics: {
          now,
          remainingMs: lease.expiresAt - now,
          pathExists,
          pathIsDirectory
        }
      },
      [],
      [
        `Lease ${lease.leaseId} is ${live ? 'LIVE' : 'NOT LIVE'} ` +
          `(status=${lease.status}, remaining=${lease.expiresAt - now}ms).`,
        `Worktree path ${lease.path} ${pathExists ? (pathIsDirectory ? 'exists (dir)' : 'exists (NOT a dir)') : 'MISSING'}.`
      ]
    ),
    options.json
  );
}

function printLeaseStatusFailed(
  io: ProgramIO,
  options: LeaseStatusOptions,
  err: unknown,
  sessionId: string
): void {
  printResult(
    io,
    fail(
      'worktree.lease-status',
      'STATUS_FAILED',
      getErrorMessage(err),
      { leaseId: options.leaseId, sessionId },
      ['Re-run after fixing the failure (see cause in the error message).']
    ),
    options.json
  );
  process.exitCode = 1;
}

function runLeaseStatus(options: LeaseStatusOptions, io: ProgramIO): void {
  const projectRoot = resolveProjectRoot(options);
  const sessionId = resolveSessionId(options, projectRoot);
  try {
    const file = leaseFilePath(joinPathSession(projectRoot, sessionId), options.leaseId);
    const loaded = loadLeaseOrStop(io, options, {
      command: 'worktree.lease-status',
      file,
      hints: { missing: STATUS_MISSING_HINTS, invalid: STATUS_INVALID_HINTS }
    });
    if (loaded.stop) {
      process.exitCode = 1;
      return;
    }
    printLeaseStatusOk(io, options, { lease: loaded.lease, sessionId, projectRoot });
  } catch (err) {
    printLeaseStatusFailed(io, options, err, sessionId);
  }
}

export function registerWorktreeLeaseStatusCommand(auth: Command, io: ProgramIO): void {
  addJsonOption(
    auth
      .command('lease-status')
      .description(LEASE_STATUS_DESCRIPTION)
      .requiredOption('--lease-id <id>', 'lease id to inspect')
      .option('--session <sid>', 'override session id')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: LeaseStatusOptions) => runLeaseStatus(options, io));
}
