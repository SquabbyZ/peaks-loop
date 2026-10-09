/**
 * Shared single-lease loader for the three read-by-lease-id commands
 * (`release`, `renew`, `lease-status`).
 *
 * All three used to inline the same two failure shapes — a missing lease
 * file (`LEASE_NOT_FOUND`) and an unparseable one (`LEASE_FILE_INVALID`) —
 * differing only in the envelope `command` string and the two hint lines.
 * Both are parameters here. The message text, the `{ leaseId, file }`
 * data payload and the caller's `process.exitCode = 1` are unchanged.
 */

import { fail } from 'peaks-loop-shared/result';
import { existsSync, readFileSync as readFileSyncNode } from 'node:fs';

import { getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { deserializeLease, type WorktreeLease } from '../../services/worktree/worktree-lease.js';

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

export function loadLeaseOrStop(
  io: ProgramIO,
  options: LeaseIdOptions,
  request: LeaseLoadRequest
): LeaseLoadResult {
  const { command, file, hints } = request;
  if (!existsSync(file)) {
    printResult(
      io,
      fail(
        command,
        'LEASE_NOT_FOUND',
        `no lease on disk at ${file}`,
        { leaseId: options.leaseId, file },
        hints.missing
      ),
      options.json
    );
    return { stop: true };
  }
  try {
    return { stop: false, lease: deserializeLease(readFileSyncNode(file, 'utf8')) };
  } catch (error) {
    printResult(
      io,
      fail(
        command,
        'LEASE_FILE_INVALID',
        getErrorMessage(error),
        { leaseId: options.leaseId, file },
        hints.invalid
      ),
      options.json
    );
    return { stop: true };
  }
}
