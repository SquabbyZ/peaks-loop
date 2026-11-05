/**
 * `peaks worktree release` — transition a lease to 'released' and run
 * `git worktree remove`.
 *
 * The action body is `runRelease` from `peaks-loop-workspace-runtime`; this
 * file owns the host policy, the effects and the envelope. The idempotent
 * already-released branch, the best-effort git removal, the lease-file failure
 * envelopes and the metric emit are unchanged.
 */

import type { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';
import { defaultStateRoot, runRelease, type WorktreeLease } from 'peaks-loop-workspace-runtime';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { emitLeaseEvent } from '../../services/observability/observability-service.js';
import { leaseEffects } from './worktree-lease-effects.js';
import { stopOnLeaseFileFailure } from './worktree-lease-load.js';
import { resolveProjectRoot, resolveSessionId } from './worktree-lease-session.js';

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

/**
 * The success tail: the release metric, then the envelope.
 * Part 4.A: the manual path emits here; auto-release is recorded in
 * dispatch-record-writer's tryAutoReleaseLease.
 */
function finishRelease(
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
}

function runReleaseAction(options: ReleaseOptions, io: ProgramIO): void {
  const projectRoot = resolveProjectRoot(options);
  const sessionId = resolveSessionId(options, projectRoot);
  try {
    const result = runRelease(
      {
        projectRoot,
        stateRoot: defaultStateRoot(projectRoot),
        sessionId,
        leaseId: options.leaseId
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
            command: 'worktree.release',
            hints: { missing: RELEASE_MISSING_HINTS, invalid: RELEASE_INVALID_HINTS }
          },
          result
        );
        return;
      case 'already-released':
        printReleaseAlreadyReleased(io, options, {
          lease: result.lease,
          sessionId,
          projectRoot
        });
        return;
      case 'ok':
        break;
    }

    finishRelease(io, options, {
      lease: result.previous,
      released: result.lease,
      sessionId,
      projectRoot,
      gitWorktreeRemoveFailed: result.gitWorktreeRemoveFailed
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
  ).action((options: ReleaseOptions) => runReleaseAction(options, io));
}
