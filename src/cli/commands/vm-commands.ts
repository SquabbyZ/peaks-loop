/**
 * `peaks vm spawn | release` — slice 2026-07-29-worktree-l2-extended Part 35.
 *
 * L4 VM isolation runtime. Parallels the design of
 * `container-commands.ts` (Part 12, docker) and
 * `worktree-auth-commands.ts` (Part 1-2, git worktree).
 *
 * Hypervisor dispatch:
 *   - `kvm`      : `virsh create` + `virsh destroy` (Linux KVM via libvirt)
 *   - `hyperkit` : `hvftool create` + `hvftool stop` (macOS HyperKit)
 *   - `hyperv`   : `hvc create` + `hvftool stop` (Windows Hyper-V via
 *     the operator-installed `hvc` shim)
 *
 * The runtime check: which hypervisor binary is on PATH +
 * (for kvm) whether the host kernel exposes /dev/kvm. The
 * spawn is fail-fast: if the requested hypervisor is not
 * available, the CLI returns VM_RUNTIME_UNAVAILABLE with a
 * remediation hint rather than falling through to a different
 * hypervisor (the caller chose a specific mode for a reason).
 *
 * Each spawned VM runs `sleep infinity` as the entrypoint; the
 * VM's working dir is mounted from the host path, and the
 * `peaks.leaseId` / `peaks.rid` labels are propagated via
 * cloud-init metadata. Real workloads are expected to use
 * `peaks vm exec` (a follow-up rid) to run commands inside
 * the VM; Part 35 ships the lease + spawn/release surface
 * only.
 */

import { execSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { fail, getErrorMessage, ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';
import { atomicWriteJson } from '../../services/ide/shared/atomic-json.js';
import {
  DEFAULT_TTL_BY_ROLE,
  DEFAULT_VM_IMAGE,
  deserializeVmLease,
  finalizeVmLease,
  generateVmLeaseId,
  markVmReleased,
  ttlForVmRole,
  vmLeaseFilePath,
  type VmHypervisor
} from '../../services/vm/vm-lease.js';

type VmOptions = {
  session?: string;
  project?: string;
  json?: boolean;
};

type SpawnOptions = VmOptions & {
  rid: string;
  role: string;
  purpose: string;
  hypervisor?: VmHypervisor;
  image?: string;
  ttl?: string;
  mount?: string;
};

type ReleaseOptions = VmOptions & {
  leaseId: string;
};

function joinPathSession(projectRoot: string, sessionId: string): string {
  return `${projectRoot.replace(/[\\/]+$/, '')}/.peaks/_runtime/${sessionId}`;
}

function resolveTtlMs(raw: string | undefined, role: string): number {
  if (typeof raw !== 'string' || raw.length === 0) return ttlForVmRole(role);
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return ttlForVmRole(role);
  return parsed;
}

function detectHypervisor(requested: VmHypervisor): { ok: true; binary: string } | { ok: false; stderr: string } {
  let binary: string;
  switch (requested) {
    case 'kvm': binary = 'virsh'; break;
    case 'hyperkit': binary = 'hvftool'; break;
    case 'hyperv': binary = 'hvc'; break;
  }
  try {
    const v = execSync(`${binary} --version`, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    if (requested === 'kvm' && !existsSync('/dev/kvm')) {
      return { ok: false, stderr: 'KVM kernel module not loaded (/dev/kvm absent)' };
    }
    return { ok: true, binary: `${binary} (${v.trim().split('\n')[0] ?? ''})` };
  } catch (err) {
    return { ok: false, stderr: (err as Error).message };
  }
}

function spawnVmWithHypervisor(args: {
  hypervisor: VmHypervisor;
  image: string;
  mount: string;
  leaseId: string;
  rid: string;
  workdir: string;
}): { vmId: string } {
  if (args.hypervisor === 'kvm') {
    // virsh create expects a domain XML file. We emit a minimal
    // XML with the image, mount, and our peaks labels.
    const xml = `<?xml version="1.0"?>
<domain type="kvm">
  <name>peaks-${args.leaseId}</name>
  <metadata><peaks:label xmlns:peaks="urn:peaks">peaks.leaseId=${args.leaseId};peaks.rid=${args.rid}</peaks:label></metadata>
  <memory>1048576</memory>
  <vcpu>1</vcpu>
  <os><type arch="x86_64">hvm</type></os>
  <devices>
    <disk type="file"><source file="${args.image}"/><target dev="vda"/></disk>
    <filesystem type="mount"><source dir="${args.mount}"/><target dir="/work"/></filesystem>
  </devices>
</domain>`;
    const xmlPath = `${args.workdir}/.peaks-vm-${args.leaseId}.xml`;
    require('node:fs').writeFileSync(xmlPath, xml, 'utf8');
    const out = execSync(`virsh create ${xmlPath}`, { cwd: args.workdir, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    return { vmId: out.trim() };
  }
  if (args.hypervisor === 'hyperkit') {
    const out = execSync(
      `hvftool create --image ${args.image} --mount ${args.mount}:/work --label peaks.leaseId=${args.leaseId} --label peaks.rid=${args.rid} --entrypoint sleep -- infinity`,
      { cwd: args.workdir, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }
    );
    return { vmId: out.trim() };
  }
  // hyperv: the hvc shim writes a vhdx + emits the new VM id.
  const out = execSync(
    `hvc create --image ${args.image} --mount ${args.mount} --label peaks.leaseId=${args.leaseId} --label peaks.rid=${args.rid}`,
    { cwd: args.workdir, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }
  );
  return { vmId: out.trim() };
}

function destroyVmWithHypervisor(args: { hypervisor: VmHypervisor; vmId: string }): boolean {
  try {
    if (args.hypervisor === 'kvm') {
      execSync(`virsh destroy ${args.vmId}`, { stdio: ['ignore', 'pipe', 'pipe'] });
    } else if (args.hypervisor === 'hyperkit') {
      execSync(`hvftool stop ${args.vmId}`, { stdio: ['ignore', 'pipe', 'pipe'] });
    } else {
      execSync(`hvc stop ${args.vmId}`, { stdio: ['ignore', 'pipe', 'pipe'] });
    }
    return true;
  } catch {
    return false;
  }
}

export function registerVmCommand(program: Command, io: ProgramIO): void {
  const cmd = program.command('vm').description('L4 VM isolation: spawn/release VM leases via kvm | hyperkit | hyperv (Part 35; pairs with --isolation vm on dispatch).');

  addJsonOption(
    cmd.command('spawn')
      .description(
        'Spawn a VM via the requested hypervisor (kvm | hyperkit | hyperv) and write a VM lease. ' +
          'Default TTL is role-aware (rd=30m / qa=15m / ui=1h); pass --ttl <ms> to override. ' +
          'Default image is `peaks-base:22-slim`; pass --image <name> to override.'
      )
      .requiredOption('--rid <rid>', 'peaks request id the lease is associated with')
      .requiredOption('--role <role>', 'sub-agent role (rd | qa | ui | sc | prd | general-purpose)')
      .requiredOption('--purpose <text>', 'why this VM was spawned (audit log)')
      .option('--hypervisor <name>', 'hypervisor to use: kvm | hyperkit | hyperv (default: auto-detect from host)')
      .option('--image <name>', `container image / vhdx to boot (default ${DEFAULT_VM_IMAGE})`)
      .option('--ttl <ms>', 'time-to-live in ms (default role-aware; override with positive number)')
      .option('--mount <path>', 'host path to mount as the VM working dir (default: <projectRoot>)')
      .option('--session <sid>', 'override session id')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: SpawnOptions) => {
    try {
      const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
      const sessionId = options.session ?? process.env.PEAKS_SESSION_ID ?? getCurrentSessionId(projectRoot) ?? 'unknown-sid';
      // Pick hypervisor: explicit > auto-detect.
      const explicit = options.hypervisor;
      const detected: VmHypervisor | null = explicit
        ? (explicit as VmHypervisor)
        : (() => {
            if (existsSync('/dev/kvm')) return 'kvm' as VmHypervisor;
            // No platform detector for hyperkit / hyperv — those
            // require explicit --hypervisor.
            return null;
          })();
      if (detected === null) {
        printResult(
          io,
          fail('vm.spawn', 'VM_HYPERVISOR_UNSPECIFIED', 'No --hypervisor given and the host does not advertise /dev/kvm. Pass --hypervisor hyperkit|hyperv to force one.', { rid: options.rid, sessionId }, [
            'Linux KVM: ensure /dev/kvm exists and the kvm kernel module is loaded.',
            'macOS HyperKit: install hvftool (brew install hyperkit) and pass --hypervisor hyperkit.',
            'Windows Hyper-V: install the hvc shim and pass --hypervisor hyperv.'
          ]),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      const probe = detectHypervisor(detected);
      if (!probe.ok) {
        printResult(
          io,
          fail('vm.spawn', 'VM_RUNTIME_UNAVAILABLE', `${detected} runtime not available: ${probe.stderr}`, { rid: options.rid, hypervisor: detected, sessionId }, [
            `Install the ${detected} runtime binary on PATH.`,
            'The dispatch fail-fast prevents fallback to a different hypervisor (caller chose this mode for a reason).'
          ]),
          options.json
        );
        process.exitCode = 1;
        return;
      }

      const leaseId = generateVmLeaseId();
      const now = Date.now();
      const ttlMs = resolveTtlMs(options.ttl, options.role);
      const image = options.image ?? DEFAULT_VM_IMAGE;
      const mount = options.mount ?? projectRoot;
      let spawnResult: { vmId: string };
      try {
        spawnResult = spawnVmWithHypervisor({
          hypervisor: detected,
          image,
          mount,
          leaseId,
          rid: options.rid,
          workdir: projectRoot
        });
      } catch (err) {
        printResult(
          io,
          fail('vm.spawn', 'VM_SPAWN_FAILED', getErrorMessage(err), { rid: options.rid, hypervisor: detected, image, sessionId }, [
            'Verify the image / vhdx is reachable on the host.',
            `For ${detected}: the spawn helper expects domain XML / hvftool args / hvc shim.`
          ]),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      const lease = finalizeVmLease({
        leaseId,
        rid: options.rid,
        role: options.role,
        path: mount,
        hypervisor: detected,
        image,
        vmId: spawnResult.vmId,
        createdAt: now,
        expiresAt: now + ttlMs,
        purpose: options.purpose
      });
      atomicWriteJson(vmLeaseFilePath(joinPathSession(projectRoot, sessionId), leaseId), lease);
      printResult(
        io,
        ok(
          'vm.spawn',
          {
            lease,
            sessionId,
            projectRoot,
            hypervisor: detected,
            runtime: probe.binary,
            ttlMs,
            nextActions: [
              `VM domain id: ${spawnResult.vmId}`,
              `Image: ${image}`,
              `Lease expires at: ${new Date(lease.expiresAt).toISOString()}`,
              'Run `peaks vm release --lease-id <lease-id>` when done',
              'For inside-the-VM exec, a follow-up rid adds `peaks vm exec` (Part 35 ships lease + spawn/release only).'
            ]
          },
          [],
          []
        ),
        options.json
      );
    } catch (err) {
      printResult(
        io,
        fail('vm.spawn', 'SPAWN_FAILED', getErrorMessage(err), { rid: options.rid, sessionId: options.session ?? process.env.PEAKS_SESSION_ID ?? 'unknown-sid' }, [
          'See error message; if the lease was not written, retry after fixing the underlying issue.'
        ]),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    cmd.command('release')
      .description('Transition a VM lease to released and run the hypervisor destroy command. Idempotent on already-released leases.')
      .requiredOption('--lease-id <id>', 'lease id returned by `peaks vm spawn`')
      .option('--session <sid>', 'override session id')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: ReleaseOptions) => {
    try {
      const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
      const sessionId = options.session ?? process.env.PEAKS_SESSION_ID ?? getCurrentSessionId(projectRoot) ?? 'unknown-sid';
      const file = vmLeaseFilePath(joinPathSession(projectRoot, sessionId), options.leaseId);
      if (!existsSync(file)) {
        printResult(
          io,
          fail('vm.release', 'LEASE_NOT_FOUND', `no VM lease on disk at ${file}`, { leaseId: options.leaseId, file }, [
            'Run `peaks vm list` (follow-up) to inspect active leases.',
            'For a never-spawned lease, this is a no-op.'
          ]),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      let lease;
      try {
        lease = deserializeVmLease(readFileSync(file, 'utf8'));
      } catch (err) {
        printResult(
          io,
          fail('vm.release', 'LEASE_FILE_INVALID', getErrorMessage(err), { leaseId: options.leaseId, file }, [
            'Delete the malformed lease file manually and re-spawn.'
          ]),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      if (lease.status === 'released') {
        printResult(
          io,
          ok('vm.release', { lease, sessionId, projectRoot, alreadyReleased: true }, [], [`Lease ${lease.leaseId} already released; nothing to do.`]),
          options.json
        );
        return;
      }
      const destroyed = destroyVmWithHypervisor({ hypervisor: lease.hypervisor, vmId: lease.vmId });
      const released = markVmReleased(lease);
      atomicWriteJson(file, released);
      printResult(
        io,
        ok(
          'vm.release',
          { lease: released, sessionId, projectRoot, vmDestroyed: destroyed },
          destroyed ? [] : [`${lease.hypervisor} destroy command failed; the lease was marked released anyway.`],
          [
            `Lease ${lease.leaseId} marked released.`,
            destroyed
              ? `${lease.hypervisor} domain ${lease.vmId} stopped.`
              : `Manual \`${lease.hypervisor} stop ${lease.vmId}\` may be needed.`
          ]
        ),
        options.json
      );
    } catch (err) {
      printResult(
        io,
        fail('vm.release', 'RELEASE_FAILED', getErrorMessage(err), { leaseId: options.leaseId, sessionId: options.session ?? process.env.PEAKS_SESSION_ID ?? 'unknown-sid' }, [
          'Verify the lease id and re-run.'
        ]),
        options.json
      );
      process.exitCode = 1;
    }
  });
}
