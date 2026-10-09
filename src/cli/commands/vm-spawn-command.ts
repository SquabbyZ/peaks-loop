// src/cli/commands/vm-spawn-command.ts
//
// `peaks vm spawn` — pick a hypervisor, probe it, spawn the VM and write the
// lease. Split out of `vm-commands.ts`; every refusal code, message, `data`
// field, next-action string and exit code is unchanged.

import { existsSync } from 'node:fs';
import type { Command } from 'commander';
import { fail, getErrorMessage, ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { atomicWriteJson } from '../../services/ide/shared/atomic-json.js';
import {
  DEFAULT_VM_IMAGE,
  finalizeVmLease,
  generateVmLeaseId,
  vmLeaseFilePath,
  type VmHypervisor
} from '../../services/vm/vm-lease.js';
import { detectHypervisor } from './vm-hypervisor-probe.js';
import { spawnVmWithHypervisor } from './vm-hypervisor-runtime.js';
import {
  joinPathSession,
  resolveTtlMs,
  resolveVmSessionId,
  type SpawnOptions
} from './vm-command-shared.js';

/** Explicit `--hypervisor` wins; otherwise only `/dev/kvm` auto-detects. */
function pickHypervisor(explicit: VmHypervisor | undefined): VmHypervisor | null {
  if (explicit !== undefined) return explicit;
  // No platform detector for hyperkit / hyperv — those require --hypervisor.
  if (existsSync('/dev/kvm')) return 'kvm';
  return null;
}

/** The lease + spawn coordinates a successful spawn reports. */
type SpawnContext = {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly hypervisor: VmHypervisor;
  readonly image: string;
  readonly mount: string;
  readonly ttlMs: number;
  readonly leaseId: string;
  readonly now: number;
};

function buildSpawnContext(
  options: SpawnOptions,
  projectRoot: string,
  sessionId: string,
  hypervisor: VmHypervisor
): SpawnContext {
  return {
    projectRoot,
    sessionId,
    hypervisor,
    image: options.image ?? DEFAULT_VM_IMAGE,
    mount: options.mount ?? projectRoot,
    ttlMs: resolveTtlMs(options.ttl, options.role),
    leaseId: generateVmLeaseId(),
    now: Date.now()
  };
}

function emitSpawnRefusal(
  io: ProgramIO,
  options: SpawnOptions,
  refusal: {
    readonly code: string;
    readonly message: string;
    readonly data: Record<string, unknown>;
    readonly nextActions: string[];
  }
): void {
  printResult(
    io,
    fail('vm.spawn', refusal.code, refusal.message, refusal.data, refusal.nextActions),
    options.json ?? false
  );
  process.exitCode = 1;
}

function emitHypervisorUnspecified(io: ProgramIO, options: SpawnOptions, sessionId: string): void {
  emitSpawnRefusal(io, options, {
    code: 'VM_HYPERVISOR_UNSPECIFIED',
    message:
      'No --hypervisor given and the host does not advertise /dev/kvm. Pass --hypervisor hyperkit|hyperv to force one.',
    data: { rid: options.rid, sessionId },
    nextActions: [
      'Linux KVM: ensure /dev/kvm exists and the kvm kernel module is loaded.',
      'macOS HyperKit: install hvftool (brew install hyperkit) and pass --hypervisor hyperkit.',
      'Windows Hyper-V: install the hvc shim and pass --hypervisor hyperv.'
    ]
  });
}

/** The lease + spawn coordinates the failure envelopes name, minus the id. */
type SpawnDetail = {
  readonly sessionId: string;
  readonly hypervisor: VmHypervisor;
  readonly stderr: string;
};

function emitRuntimeUnavailable(io: ProgramIO, options: SpawnOptions, detail: SpawnDetail): void {
  emitSpawnRefusal(io, options, {
    code: 'VM_RUNTIME_UNAVAILABLE',
    message: `${detail.hypervisor} runtime not available: ${detail.stderr}`,
    data: { rid: options.rid, hypervisor: detail.hypervisor, sessionId: detail.sessionId },
    nextActions: [
      `Install the ${detail.hypervisor} runtime binary on PATH.`,
      'The dispatch fail-fast prevents fallback to a different hypervisor (caller chose this mode for a reason).'
    ]
  });
}

/** Spawn, or print the spawn failure and return null. */
function spawnOrFail(io: ProgramIO, options: SpawnOptions, ctx: SpawnContext): string | null {
  try {
    return spawnVmWithHypervisor({
      hypervisor: ctx.hypervisor,
      image: ctx.image,
      mount: ctx.mount,
      leaseId: ctx.leaseId,
      rid: options.rid,
      workdir: ctx.projectRoot
    }).vmId;
  } catch (err) {
    emitSpawnRefusal(io, options, {
      code: 'VM_SPAWN_FAILED',
      message: getErrorMessage(err),
      data: {
        rid: options.rid,
        hypervisor: ctx.hypervisor,
        image: ctx.image,
        sessionId: ctx.sessionId
      },
      nextActions: [
        'Verify the image / vhdx is reachable on the host.',
        `For ${ctx.hypervisor}: the spawn helper expects domain XML / hvftool args / hvc shim.`
      ]
    });
    return null;
  }
}

function emitSpawnSuccess(
  io: ProgramIO,
  options: SpawnOptions,
  spawned: { readonly ctx: SpawnContext; readonly vmId: string; readonly binary: string }
): void {
  const { ctx, vmId, binary } = spawned;
  const lease = finalizeVmLease({
    leaseId: ctx.leaseId,
    rid: options.rid,
    role: options.role,
    path: ctx.mount,
    hypervisor: ctx.hypervisor,
    image: ctx.image,
    vmId,
    createdAt: ctx.now,
    expiresAt: ctx.now + ctx.ttlMs,
    purpose: options.purpose
  });
  atomicWriteJson(
    vmLeaseFilePath(joinPathSession(ctx.projectRoot, ctx.sessionId), ctx.leaseId),
    lease
  );
  printResult(
    io,
    ok(
      'vm.spawn',
      {
        lease,
        sessionId: ctx.sessionId,
        projectRoot: ctx.projectRoot,
        hypervisor: ctx.hypervisor,
        runtime: binary,
        ttlMs: ctx.ttlMs,
        nextActions: [
          `VM domain id: ${vmId}`,
          `Image: ${ctx.image}`,
          `Lease expires at: ${new Date(lease.expiresAt).toISOString()}`,
          'Run `peaks vm release --lease-id <lease-id>` when done',
          'For inside-the-VM exec, a follow-up rid adds `peaks vm exec` (Part 35 ships lease + spawn/release only).'
        ]
      },
      [],
      []
    ),
    options.json ?? false
  );
}

export function runVmSpawn(io: ProgramIO, options: SpawnOptions): void {
  try {
    const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const sessionId = resolveVmSessionId(projectRoot, options.session);
    const detected = pickHypervisor(options.hypervisor);
    if (detected === null) {
      emitHypervisorUnspecified(io, options, sessionId);
      return;
    }
    const probe = detectHypervisor(detected);
    if (!probe.ok) {
      emitRuntimeUnavailable(io, options, {
        sessionId,
        hypervisor: detected,
        stderr: probe.stderr
      });
      return;
    }

    const ctx = buildSpawnContext(options, projectRoot, sessionId, detected);
    const vmId = spawnOrFail(io, options, ctx);
    if (vmId === null) return;
    emitSpawnSuccess(io, options, { ctx, vmId, binary: probe.binary });
  } catch (err) {
    emitSpawnRefusal(io, options, {
      code: 'SPAWN_FAILED',
      message: getErrorMessage(err),
      data: {
        rid: options.rid,
        sessionId: options.session ?? process.env.PEAKS_SESSION_ID ?? 'unknown-sid'
      },
      nextActions: [
        'See error message; if the lease was not written, retry after fixing the underlying issue.'
      ]
    });
  }
}

export function registerVmSpawnCommand(cmd: Command, io: ProgramIO): void {
  addJsonOption(
    cmd
      .command('spawn')
      .description(
        'Spawn a VM via the requested hypervisor (kvm | hyperkit | hyperv) and write a VM lease. ' +
          'Default TTL is role-aware (rd=30m / qa=15m / ui=1h); pass --ttl <ms> to override. ' +
          'Default image is `peaks-base:22-slim`; pass --image <name> to override.'
      )
      .requiredOption('--rid <rid>', 'peaks request id the lease is associated with')
      .requiredOption('--role <role>', 'sub-agent role (rd | qa | ui | sc | prd | general-purpose)')
      .requiredOption('--purpose <text>', 'why this VM was spawned (audit log)')
      .option(
        '--hypervisor <name>',
        'hypervisor to use: kvm | hyperkit | hyperv (default: auto-detect from host)'
      )
      .option('--image <name>', `container image / vhdx to boot (default ${DEFAULT_VM_IMAGE})`)
      .option(
        '--ttl <ms>',
        'time-to-live in ms (default role-aware; override with positive number)'
      )
      .option('--mount <path>', 'host path to mount as the VM working dir (default: <projectRoot>)')
      .option('--session <sid>', 'override session id')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: SpawnOptions) => runVmSpawn(io, options));
}
