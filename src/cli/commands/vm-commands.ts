// src/cli/commands/vm-commands.ts
//
// L4 VM isolation: the `peaks vm` parent, its status probe, and the
// spawn/release pair. Split out of the single file this used to be; the parent
// description, the registration order and every verb's surface are unchanged.
//
// Hypervisor dispatch:
//   - `kvm`      : `virsh create` + `virsh destroy` (Linux KVM via libvirt)
//   - `hyperkit` : `hvftool create` + `hvftool stop` (macOS HyperKit)
//   - `hyperv`   : `hvc create` + `hvftool stop` (Windows Hyper-V via
//     the operator-installed `hvc` shim)
//
// The runtime check: which hypervisor binary is on PATH +
// (for kvm) whether the host kernel exposes /dev/kvm. The
// spawn is fail-fast: if the requested hypervisor is not
// available, the CLI returns VM_RUNTIME_UNAVAILABLE with a
// remediation hint rather than falling through to a different
// hypervisor (the caller chose a specific mode for a reason).
//
// Each spawned VM runs `sleep infinity` as the entrypoint; the
// VM's working dir is mounted from the host path, and the
// `peaks.leaseId` / `peaks.rid` labels are propagated via
// cloud-init metadata. Real workloads are expected to use
// `peaks vm exec` (a follow-up rid) to run commands inside
// the VM; Part 35 ships the lease + spawn/release surface
// only.
//
// The verb bodies live beside this file (`vm-spawn-command.ts`,
// `vm-release-command.ts`), over the shared vocabulary in
// `vm-command-shared.ts` and the dispatch helpers in
// `vm-hypervisor-runtime.ts`; `vm-hypervisor-probe.ts` and
// `vm-status-command.ts` were already siblings.

import type { Command } from 'commander';

import type { ProgramIO } from '../cli-helpers.js';
import { registerVmStatusCommand } from './vm-status-command.js';
import { registerVmSpawnCommand } from './vm-spawn-command.js';
import { registerVmReleaseCommand } from './vm-release-command.js';

export function registerVmCommand(program: Command, io: ProgramIO): void {
  const cmd = program
    .command('vm')
    .description(
      'L4 VM isolation: spawn/release VM leases via kvm | hyperkit | hyperv (Part 35; pairs with --isolation vm on dispatch).'
    );

  // The host probe rides on the same parent, so `peaks vm status`
  // can say which prerequisite is missing before a spawn fails.
  registerVmStatusCommand(cmd, io);
  registerVmSpawnCommand(cmd, io);
  registerVmReleaseCommand(cmd, io);
}
