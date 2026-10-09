/**
 * `peaks worktree release` — transition a lease to 'released' and run
 * `git worktree remove`.
 *
 * Extracted verbatim from `worktree-lease-commands.ts` (mechanical move of
 * the `.action()` body). The lease-file failures now route through the
 * shared `loadLeaseOrStop` (same envelope, same hints, same exit code);
 * the idempotent already-released branch, the best-effort git removal and
 * the ok/fail envelopes are unchanged.
 */

import type { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { atomicWriteJson } from '../../services/ide/shared/atomic-json.js';
import { emitLeaseEvent } from '../../services/observability/observability-service.js';
import {
  leaseFilePath,
  markReleased,
  type WorktreeLease
} from '../../services/worktree/worktree-lease.js';
import { loadLeaseOrStop } from './worktree-lease-load.js';
import { removeWorktreeBestEffort } from './worktree-lease-git.js';
import { joinPathSession, resolveProjectRoot, resolveSessionId } from './worktree-lease-session.js';

const RELEASE_DESCRIPTION =
  'Transition a lease to released and run `git worktree remove`. Idempotent on already-released leases.';

const RELEASE_MISSING_HINTS: string[] = [
  'Run `peaks worktree list` to inspect active leases.',
  'For a never-spawned lease, this is a no-op — no further action needed.'
];

const RELEASE_INVALID_HINTS: string[] = [
  'Delete the malformed lease file manually and re-issue spawn.',
  'For security, release never fails open on a malformed lease.'
];

type ReleaseOptions = {
  leaseId: string;
  session?: string;
  project?: string;
  json?: boolean;
};

function printReleaseAlreadyReleased(
  io: ProgramIO,
  options: ReleaseOptions,
  ctx: { lease: WorktreeLease; sessionId: string; projectRoot: string }
): void {
  const { lease, sessionId, projectRoot } = ctx;
  // Idempotent: already released, nothing to do.
  printResult(
    io,
    ok(
      'worktree.release',
      { lease, sessionId, projectRoot, alreadyReleased: true },
      [],
      [`Lease ${lease.leaseId} already released; nothing to do.`]
    ),
    options.json
  );
}

function printReleaseDone(
  io: ProgramIO,
  options: ReleaseOptions,
  ctx: {
    lease: WorktreeLease;
    released: WorktreeLease;
    sessionId: string;
    projectRoot: string;
    gitWorktreeRemoveFailed: boolean;
  }
): void {
  const { lease, released, sessionId, projectRoot, gitWorktreeRemoveFailed } = ctx;
  printResult(
    io,
    ok(
      'worktree.release',
      { lease: released, sessionId, projectRoot, gitWorktreeRemoveFailed },
      gitWorktreeRemoveFailed
        ? [
            'git worktree remove failed (likely the path was already pruned); lease marked released.'
          ]
        : [],
      [
        `Lease ${lease.leaseId} marked released.`,
        gitWorktreeRemoveFailed
          ? 'Manual `git worktree prune` may be needed.'
          : `Worktree ${lease.path} removed.`
      ]
    ),
    options.json
  );
}

function printReleaseFailed(
  io: ProgramIO,
  options: ReleaseOptions,
  error: unknown,
  sessionId: string
): void {
  printResult(
    io,
    fail(
      'worktree.release',
      'RELEASE_FAILED',
      getErrorMessage(error),
      { leaseId: options.leaseId, sessionId },
      ['Verify the lease id and re-run.', 'If the lease was never spawned, no-op.']
    ),
    options.json
  );
  process.exitCode = 1;
}

function runRelease(options: ReleaseOptions, io: ProgramIO): void {
  const projectRoot = resolveProjectRoot(options);
  const sessionId = resolveSessionId(options, projectRoot);
  try {
    const file = leaseFilePath(joinPathSession(projectRoot, sessionId), options.leaseId);
    const loaded = loadLeaseOrStop(io, options, {
      command: 'worktree.release',
      file,
      hints: { missing: RELEASE_MISSING_HINTS, invalid: RELEASE_INVALID_HINTS }
    });
    if (loaded.stop) {
      process.exitCode = 1;
      return;
    }
    const lease = loaded.lease;

    if (lease.status === 'released') {
      printReleaseAlreadyReleased(io, options, { lease, sessionId, projectRoot });
      return;
    }

    // Run `git worktree remove` from the project root. If the path is
    // missing on disk (e.g. manually pruned), this fails; we still
    // update the lease state so the L2 hook (Part 2) treats it as
    // released.
    const gitWorktreeRemoveFailed = removeWorktreeBestEffort(projectRoot, lease.path);

    const released = markReleased(lease);
    atomicWriteJson(file, released);
    // Part 4.A: emit release metric (manual path; auto-release is
    // recorded in dispatch-record-writer's tryAutoReleaseLease).
    emitLeaseEvent({
      sessionId,
      projectRoot,
      kind: 'release',
      leaseId: released.leaseId,
      rid: released.rid,
      role: released.role
    });

    printReleaseDone(io, options, {
      lease,
      released,
      sessionId,
      projectRoot,
      gitWorktreeRemoveFailed
    });
  } catch (error: unknown) {
    printReleaseFailed(io, options, error, sessionId);
  }
}

export function registerWorktreeLeaseReleaseCommand(auth: Command, io: ProgramIO): void {
  addJsonOption(
    auth
      .command('release')
      .description(RELEASE_DESCRIPTION)
      .requiredOption('--lease-id <id>', 'lease id returned by `peaks worktree spawn`')
      .option('--session <sid>', 'override session id')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: ReleaseOptions) => runRelease(options, io));
}
