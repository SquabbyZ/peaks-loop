// src/cli/commands/vm-status-command.ts
//
// `peaks vm status` — the read-only host probe that rides on the `vm` parent.
//
// `peaks vm spawn` refuses with VM_RUNTIME_UNAVAILABLE and
// `peaks sub-agent dispatch --isolation vm` refuses with
// ISOLATION_VM_NOT_YET_IMPLEMENTED, but neither said WHICH prerequisite is
// missing on the machine actually running the command: the hypervisor binary,
// the KVM device node, or a host with no hypervisor at all. The only way to
// find out was to attempt a spawn that was going to fail.
//
// This reports it, and it does not pretend the runtime exists: a probe that
// finds libvirt on PATH still leaves `--isolation vm` refused, because the
// missing piece is peaks' VM runtime (image, `vm exec`, per-OS bindings), not
// the hypervisor. The envelope says so rather than letting a green probe read
// as "vm works now".
//

import type { Command } from 'commander';

import { probeHypervisors } from './vm-hypervisor-probe.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';

type VmStatusOptions = {
  json?: boolean;
};

export function registerVmStatusCommand(vm: Command, io: ProgramIO): void {
  addJsonOption(
    vm
      .command('status')
      .description(
        'Report which VM hypervisor this host offers (read-only probe; the peaks VM runtime is a separate rid)'
      )
  ).action((options: VmStatusOptions) => {
    const rows = probeHypervisors();
    const anyAvailable = rows.some((row) => row.available);
    const data = {
      platform: process.platform,
      hypervisors: rows,
      anyAvailable,
      // The runtime statement, kept next to the probe result so the two can
      // never be read apart.
      dispatchIsolationVm: 'not implemented'
    };

    for (const row of rows) {
      io.stdout(
        `${row.hypervisor}  ${row.available ? 'present' : 'absent'}  ${row.binary}: ${row.detail}`
      );
    }
    io.stdout(`platform:  ${process.platform}`);

    const nextActions = [
      'The peaks VM runtime (image build, `peaks vm exec`, Hyper-V/HyperKit bindings) is not implemented yet: `peaks sub-agent dispatch --isolation vm` stays refused even when a hypervisor is present.',
      'For isolation today use --isolation worktree (L2, production) or --isolation container (L4, docker/podman).'
    ];

    if (!anyAvailable) {
      printResult(
        io,
        fail(
          'vm.status',
          'VM_RUNTIME_UNAVAILABLE',
          `no VM hypervisor is usable on ${process.platform}: install one of virsh (KVM/libvirt, Linux), hvftool (HyperKit, macOS) or hvc (Hyper-V, Windows) — and on Linux the /dev/kvm device node — or drop --isolation and use worktree/container.`,
          data,
          nextActions
        ),
        options.json
      );
      process.exitCode = 1;
      return;
    }

    printResult(io, ok('vm.status', data, [], nextActions), options.json);
  });
}
