// src/cli/commands/vm-release-command.ts
//
// `peaks vm release` — transition a VM lease to released and run the
// hypervisor destroy command. Split out of `vm-commands.ts`; every refusal
// code, message, `data` field, warning and next-action string is unchanged.

import { existsSync, readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { fail, getErrorMessage, ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { atomicWriteJson } from '../../services/ide/shared/atomic-json.js';
import {
  deserializeVmLease,
  markVmReleased,
  vmLeaseFilePath,
  type VmLease
} from '../../services/vm/vm-lease.js';
import { destroyVmWithHypervisor } from './vm-hypervisor-runtime.js';
import { joinPathSession, resolveVmSessionId, type ReleaseOptions } from './vm-command-shared.js';

/** Print a `vm.release` refusal; the caller stops. */
function emitReleaseRefusal(
  io: ProgramIO,
  options: ReleaseOptions,
  refusal: {
    readonly code: string;
    readonly message: string;
    readonly data: Record<string, unknown>;
    readonly nextActions: string[];
  }
): void {
  printResult(
    io,
    fail('vm.release', refusal.code, refusal.message, refusal.data, refusal.nextActions),
    options.json ?? false
  );
  process.exitCode = 1;
}

/** The lease on disk, or null after the matching refusal envelope was printed. */
function readLeaseOrRefuse(io: ProgramIO, options: ReleaseOptions, file: string): VmLease | null {
  if (!existsSync(file)) {
    emitReleaseRefusal(io, options, {
      code: 'LEASE_NOT_FOUND',
      message: `no VM lease on disk at ${file}`,
      data: { leaseId: options.leaseId, file },
      nextActions: [
        'Run `peaks vm list` (follow-up) to inspect active leases.',
        'For a never-spawned lease, this is a no-op.'
      ]
    });
    return null;
  }
  try {
    return deserializeVmLease(readFileSync(file, 'utf8'));
  } catch (err) {
    emitReleaseRefusal(io, options, {
      code: 'LEASE_FILE_INVALID',
      message: getErrorMessage(err),
      data: { leaseId: options.leaseId, file },
      nextActions: ['Delete the malformed lease file manually and re-spawn.']
    });
    return null;
  }
}

/** Where the lease being released lives, for the envelopes that name it. */
type ReleaseTarget = {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly file: string;
};

function emitAlreadyReleased(
  io: ProgramIO,
  options: ReleaseOptions,
  target: ReleaseTarget,
  lease: VmLease
): void {
  printResult(
    io,
    ok(
      'vm.release',
      {
        lease,
        sessionId: target.sessionId,
        projectRoot: target.projectRoot,
        alreadyReleased: true
      },
      [],
      [`Lease ${lease.leaseId} already released; nothing to do.`]
    ),
    options.json ?? false
  );
}

function emitReleaseSuccess(
  io: ProgramIO,
  options: ReleaseOptions,
  target: ReleaseTarget,
  lease: VmLease
): void {
  const destroyed = destroyVmWithHypervisor({ hypervisor: lease.hypervisor, vmId: lease.vmId });
  const released = markVmReleased(lease);
  atomicWriteJson(target.file, released);
  printResult(
    io,
    ok(
      'vm.release',
      {
        lease: released,
        sessionId: target.sessionId,
        projectRoot: target.projectRoot,
        vmDestroyed: destroyed
      },
      destroyed
        ? []
        : [`${lease.hypervisor} destroy command failed; the lease was marked released anyway.`],
      [
        `Lease ${lease.leaseId} marked released.`,
        destroyed
          ? `${lease.hypervisor} domain ${lease.vmId} stopped.`
          : `Manual \`${lease.hypervisor} stop ${lease.vmId}\` may be needed.`
      ]
    ),
    options.json ?? false
  );
}

export function runVmRelease(io: ProgramIO, options: ReleaseOptions): void {
  try {
    const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const sessionId = resolveVmSessionId(projectRoot, options.session);
    const file = vmLeaseFilePath(joinPathSession(projectRoot, sessionId), options.leaseId);
    const lease = readLeaseOrRefuse(io, options, file);
    if (lease === null) return;

    if (lease.status === 'released') {
      emitAlreadyReleased(io, options, { projectRoot, sessionId, file }, lease);
      return;
    }
    emitReleaseSuccess(io, options, { projectRoot, sessionId, file }, lease);
  } catch (err) {
    printResult(
      io,
      fail(
        'vm.release',
        'RELEASE_FAILED',
        getErrorMessage(err),
        {
          leaseId: options.leaseId,
          sessionId: options.session ?? process.env.PEAKS_SESSION_ID ?? 'unknown-sid'
        },
        ['Verify the lease id and re-run.']
      ),
      options.json ?? false
    );
    process.exitCode = 1;
  }
}

export function registerVmReleaseCommand(cmd: Command, io: ProgramIO): void {
  addJsonOption(
    cmd
      .command('release')
      .description(
        'Transition a VM lease to released and run the hypervisor destroy command. Idempotent on already-released leases.'
      )
      .requiredOption('--lease-id <id>', 'lease id returned by `peaks vm spawn`')
      .option('--session <sid>', 'override session id')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: ReleaseOptions) => runVmRelease(io, options));
}
