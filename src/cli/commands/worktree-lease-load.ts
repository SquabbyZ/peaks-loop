/**
 * Shared single-lease failure envelopes for the read-by-lease-id commands
 * (`release`, `renew`, `lease-status`).
 *
 * All of them surface the same two failure shapes — a missing lease file
 * (`LEASE_NOT_FOUND`) and an unparseable one (`LEASE_FILE_INVALID`) — differing
 * only in the envelope `command` string and the two hint lines. Both are
 * parameters here. The message text, the `{ leaseId, file }` data payload and
 * the caller's `process.exitCode = 1` are unchanged.
 *
 * `printLeaseFileFailure` takes the failure record the workspace-runtime
 * package's actions return, so `release` and `renew` keep this exact envelope
 * even though the load now happens inside the package.
 */

import { fail } from 'peaks-loop-shared/result';
import { existsSync, readFileSync as readFileSyncNode } from 'node:fs';

import {
  deserializeLease,
  type LeaseFileFailure,
  type WorktreeLease
} from 'peaks-loop-workspace-runtime';

import { getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

/** The option surface the loader reads: the lease id and `--json`. */
export interface LeaseIdOptions {
  leaseId: string;
  json?: boolean;
}

export interface LeaseLoadHints {
  /** nextActions printed for `LEASE_NOT_FOUND`. */
  missing: string[];
  /** nextActions printed for `LEASE_FILE_INVALID`. */
  invalid: string[];
}

export interface LeaseLoadRequest {
  /** The envelope `command` string (e.g. `worktree.renew`). */
  command: string;
  /** Absolute path of the lease file to read. */
  file: string;
  hints: LeaseLoadHints;
}

export type LeaseLoadResult = { stop: true } | { stop: false; lease: WorktreeLease };

/**
 * Print the envelope for a lease-file failure and report that the caller must
 * stop: `release` and `renew` both set `process.exitCode = 1` on it.
 */
export function stopOnLeaseFileFailure(
  io: ProgramIO,
  options: LeaseIdOptions,
  request: { command: string; hints: LeaseLoadHints },
  failure: LeaseFileFailure
): true {
  printLeaseFileFailure(io, options, request, failure);
  process.exitCode = 1;
  return true;
}

/** Print the envelope for a missing or malformed lease file. */
function printLeaseFileFailure(
  io: ProgramIO,
  options: LeaseIdOptions,
  request: { command: string; hints: LeaseLoadHints },
  failure: LeaseFileFailure
): void {
  const { command, hints } = request;
  if (failure.kind === 'lease-not-found') {
    printResult(
      io,
      fail(
        command,
        'LEASE_NOT_FOUND',
        `no lease on disk at ${failure.file}`,
        { leaseId: options.leaseId, file: failure.file },
        hints.missing
      ),
      options.json
    );
    return;
  }
  printResult(
    io,
    fail(
      command,
      'LEASE_FILE_INVALID',
      failure.error,
      { leaseId: options.leaseId, file: failure.file },
      hints.invalid
    ),
    options.json
  );
}

export function loadLeaseOrStop(
  io: ProgramIO,
  options: LeaseIdOptions,
  request: LeaseLoadRequest
): LeaseLoadResult {
  const { command, file, hints } = request;
  if (!existsSync(file)) {
    printLeaseFileFailure(io, options, request, { kind: 'lease-not-found', file });
    return { stop: true };
  }
  try {
    // Re-uses the package's deserializer so a malformed file is rejected by
    // the same validator the lifecycle actions apply.
    return { stop: false, lease: deserializeLease(readFileSyncNode(file, 'utf8')) };
  } catch (error) {
    printLeaseFileFailure(
      io,
      options,
      { command, hints },
      {
        kind: 'lease-invalid',
        file,
        error: getErrorMessage(error)
      }
    );
    return { stop: true };
  }
}
