import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { fail, getErrorMessage, ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { atomicWriteJson } from '../../services/ide/shared/atomic-json.js';
import {
  containerLeaseFilePath,
  deserializeContainerLease,
  markContainerReleased,
  type ContainerLease
} from '../../services/container/container-lease.js';
import {
  detectContainerRuntime,
  joinPathSession,
  resolveContainerTarget,
  type ReleaseOptions
} from './container-command-shared.js';

/** The lease file plus the identity the release envelopes report. */
type ReleasePlan = {
  options: ReleaseOptions;
  io: ProgramIO;
  projectRoot: string;
  sessionId: string;
  file: string;
  lease: ContainerLease;
};

export function registerContainerReleaseCommand(cmd: Command, io: ProgramIO): void {
  addJsonOption(
    cmd
      .command('release')
      .description(
        'Transition a container lease to released and run `docker rm --force`. Idempotent on already-released leases.'
      )
      .requiredOption('--lease-id <id>', 'lease id returned by `peaks container spawn`')
      .option('--session <sid>', 'override session id')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: ReleaseOptions) => runContainerRelease(io, options));
}

/** Read + parse the lease file; `null` once the refusal is emitted. */
function readLease(io: ProgramIO, options: ReleaseOptions, file: string): ContainerLease | null {
  if (!existsSync(file)) {
    printResult(
      io,
      fail(
        'container.release',
        'LEASE_NOT_FOUND',
        `no lease on disk at ${file}`,
        {
          leaseId: options.leaseId,
          file
        },
        [
          'Run `peaks container list` to inspect active leases.',
          'For a never-spawned lease, this is a no-op — no further action needed.'
        ]
      ),
      options.json
    );
    process.exitCode = 1;
    return null;
  }
  try {
    return deserializeContainerLease(readFileSync(file, 'utf8'));
  } catch (err) {
    printResult(
      io,
      fail(
        'container.release',
        'LEASE_FILE_INVALID',
        getErrorMessage(err),
        {
          leaseId: options.leaseId,
          file
        },
        [
          'Delete the malformed lease file manually and re-issue spawn.',
          'For security, release never fails open on a malformed lease.'
        ]
      ),
      options.json
    );
    process.exitCode = 1;
    return null;
  }
}

/** `docker rm --force`, tolerating a container that is already gone. */
function removeContainer(lease: ContainerLease, projectRoot: string): boolean {
  try {
    const detected = detectContainerRuntime(undefined);
    const runtimeCmd = detected.ok ? detected.runtime : 'docker';
    execSync(`${runtimeCmd} rm --force "${lease.containerId}"`, {
      cwd: projectRoot,
      stdio: 'pipe',
      encoding: 'utf8',
      windowsHide: true
    });
    return false;
  } catch {
    return true;
  }
}

function runContainerRelease(io: ProgramIO, options: ReleaseOptions): void {
  const { projectRoot, sessionId } = resolveContainerTarget(options);
  try {
    const file = containerLeaseFilePath(joinPathSession(projectRoot, sessionId), options.leaseId);
    const lease = readLease(io, options, file);
    if (lease === null) return;
    if (lease.status === 'released') {
      printResult(
        io,
        ok(
          'container.release',
          { lease, sessionId, projectRoot, alreadyReleased: true },
          [],
          [`Lease ${lease.leaseId} already released; nothing to do.`]
        ),
        options.json
      );
      return;
    }
    const outcome = releaseLease({ options, io, projectRoot, sessionId, file, lease });
    printResult(
      io,
      ok('container.release', outcome.data, outcome.warnings, outcome.nextActions),
      options.json
    );
  } catch (err) {
    printResult(
      io,
      fail(
        'container.release',
        'RELEASE_FAILED',
        getErrorMessage(err),
        {
          leaseId: options.leaseId,
          sessionId
        },
        ['Verify the lease id and re-run.', 'If the lease was never spawned, no-op.']
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

/**
 * `docker rm --force` the container, flip the lease to released and write it
 * back. A failed `docker rm` is reported, not fatal: the lease is the source
 * of truth and it is still marked released.
 */
function releaseLease(plan: ReleasePlan): {
  data: Record<string, unknown>;
  warnings: string[];
  nextActions: string[];
} {
  const { projectRoot, sessionId, file, lease } = plan;
  const dockerRmFailed = removeContainer(lease, projectRoot);
  const released = markContainerReleased(lease);
  atomicWriteJson(file, released);
  return {
    data: { lease: released, sessionId, projectRoot, dockerRmFailed },
    warnings: dockerRmFailed
      ? ['docker rm failed (likely the container was already removed); lease marked released.']
      : [],
    nextActions: [
      `Lease ${lease.leaseId} marked released.`,
      dockerRmFailed
        ? 'Manual `docker ps -a` + `docker rm` may be needed.'
        : `Container ${lease.containerId} removed.`
    ]
  };
}
