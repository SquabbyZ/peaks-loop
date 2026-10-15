// The `--isolation` lease set-up of `peaks sub-agent dispatch`. Validates the mode and
// spawns the container/worktree lease, handing the handles back. `vm` is not a mode:
// it is refused by the same guard as any other unrecognised value.
import { fail, getErrorMessage } from 'peaks-loop-shared/result';
import { printResult, type ProgramIO } from '../cli-helpers.js';
import {
  spawnWorktreeLease,
  spawnContainerLease
} from '../../services/dispatch/isolation-lease.js';
import type { DispatchOptions } from './sub-agent-shared.js';

export interface IsolationLeaseInput {
  projectRoot: string;
  sid: string;
  rid: string;
  role: string;
  batchId: string;
  asJson: boolean;
}

export interface IsolationLease {
  isolationMode: 'worktree' | 'container' | null;
  leaseId: string | null;
  worktreePath: string | null;
  worktreeBranch: string | null;
}

function rejectInvalidIsolation(
  io: ProgramIO,
  isolation: string,
  role: string,
  asJson: boolean
): null {
  printResult(
    io,
    fail(
      'sub-agent.dispatch',
      'INVALID_ISOLATION',
      `--isolation only accepts "worktree" | "container" (got "${isolation}")`,
      {
        role,
        toolCall: null,
        dispatchRecordPath: null
      } as never,
      ['Drop --isolation or pass --isolation worktree / --isolation container.']
    ),
    asJson
  );
  process.exitCode = 1;
  return null;
}

async function spawnContainerIsolation(
  io: ProgramIO,
  input: IsolationLeaseInput
): Promise<IsolationLease | null> {
  const { projectRoot, sid, rid, role, batchId, asJson } = input;
  // isolation is now live (Part 8 contract was the
  // bridge; Part 12 is the runtime). Shell out to
  // `peaks container spawn` to run `docker run` and
  // write the container lease.
  const isolationMode = 'container' as const;
  try {
    const spawnResult = await spawnContainerLease({
      projectRoot,
      sessionId: sid,
      rid,
      role,
      purpose: `auto-spawned by dispatch --isolation container (batch=${batchId})`
    });
    // Reuse the leaseId variable — same field semantically
    // (id of the isolation surface the dispatch owns).
    return {
      isolationMode,
      leaseId: spawnResult.leaseId,
      worktreePath: null,
      worktreeBranch: null
    };
  } catch (error) {
    printResult(
      io,
      fail(
        'sub-agent.dispatch',
        'ISOLATION_CONTAINER_SPAWN_FAILED',
        getErrorMessage(error),
        {
          role,
          toolCall: null,
          dispatchRecordPath: null
        } as never,
        [
          'The dispatch aborts when --isolation container lease spawn fails; retry without --isolation or fix the underlying docker error.',
          'For environments without a docker daemon, use --isolation worktree (the L2 production path).'
        ]
      ),
      asJson
    );
    process.exitCode = 1;
    return null;
  }
}

async function spawnWorktreeIsolation(
  io: ProgramIO,
  input: IsolationLeaseInput
): Promise<IsolationLease | null> {
  const { projectRoot, sid, rid, role, batchId, asJson } = input;
  const isolationMode = 'worktree' as const;
  try {
    const spawnResult = await spawnWorktreeLease({
      projectRoot,
      sessionId: sid,
      rid,
      role,
      purpose: `auto-spawned by dispatch --isolation worktree (batch=${batchId})`
    });
    return {
      isolationMode,
      leaseId: spawnResult.leaseId,
      worktreePath: spawnResult.path,
      worktreeBranch: spawnResult.branch
    };
  } catch (error) {
    printResult(
      io,
      fail(
        'sub-agent.dispatch',
        'ISOLATION_SPAWN_FAILED',
        getErrorMessage(error),
        {
          role,
          toolCall: null,
          dispatchRecordPath: null
        } as never,
        [
          'The dispatch aborts when --isolation worktree lease spawn fails; retry without --isolation or fix the underlying git error.'
        ]
      ),
      asJson
    );
    process.exitCode = 1;
    return null;
  }
}

export async function resolveIsolationLease(
  io: ProgramIO,
  options: DispatchOptions,
  input: IsolationLeaseInput
): Promise<IsolationLease | null> {
  const { role, asJson } = input;
  // auto-spawns a worktree lease and injects PEAKS_WORKTREE_LEASE_ID
  // into the sub-agent dispatch envelope. This is the bridge that
  // makes the lease-aware gate (Part 2.B) work for sub-agents:
  // without this injection, the gate has no leaseId to consult and
  // the sub-agent would need a separate `peaks worktree auth grant`.
  if (typeof options.isolation === 'string' && options.isolation.length > 0) {
    if (options.isolation !== 'worktree' && options.isolation !== 'container') {
      return rejectInvalidIsolation(io, options.isolation, role, asJson);
    }
    if (options.isolation === 'container') {
      return spawnContainerIsolation(io, input);
    }
    if (options.isolation === 'worktree') {
      return spawnWorktreeIsolation(io, input);
    }
  }

  return { isolationMode: null, leaseId: null, worktreePath: null, worktreeBranch: null };
}
