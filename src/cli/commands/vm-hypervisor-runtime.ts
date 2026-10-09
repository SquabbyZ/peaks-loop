// src/cli/commands/vm-hypervisor-runtime.ts
//
// The two hypervisor dispatch helpers `peaks vm spawn` / `peaks vm release`
// call: create a domain and destroy one. Split out of `vm-commands.ts`; every
// command line, cwd, stdio tuple and `windowsHide` flag is unchanged.

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

import type { VmHypervisor } from '../../services/vm/vm-lease.js';

export function spawnVmWithHypervisor(args: {
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
    writeFileSync(xmlPath, xml, 'utf8');
    const out = execSync(`virsh create ${xmlPath}`, {
      cwd: args.workdir,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      windowsHide: true
    });
    return { vmId: out.trim() };
  }
  if (args.hypervisor === 'hyperkit') {
    const out = execSync(
      `hvftool create --image ${args.image} --mount ${args.mount}:/work --label peaks.leaseId=${args.leaseId} --label peaks.rid=${args.rid} --entrypoint sleep -- infinity`,
      { cwd: args.workdir, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', windowsHide: true }
    );
    return { vmId: out.trim() };
  }
  // hyperv: the hvc shim writes a vhdx + emits the new VM id.
  const out = execSync(
    `hvc create --image ${args.image} --mount ${args.mount} --label peaks.leaseId=${args.leaseId} --label peaks.rid=${args.rid}`,
    { cwd: args.workdir, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', windowsHide: true }
  );
  return { vmId: out.trim() };
}

export function destroyVmWithHypervisor(args: { hypervisor: VmHypervisor; vmId: string }): boolean {
  try {
    if (args.hypervisor === 'kvm') {
      execSync(`virsh destroy ${args.vmId}`, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
    } else if (args.hypervisor === 'hyperkit') {
      execSync(`hvftool stop ${args.vmId}`, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
    } else {
      execSync(`hvc stop ${args.vmId}`, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    }
    return true;
  } catch {
    return false;
  }
}
