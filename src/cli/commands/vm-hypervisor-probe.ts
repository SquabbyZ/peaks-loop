// src/cli/commands/vm-hypervisor-probe.ts
//
// The host-side question every `peaks vm` path has to answer: is there a
// hypervisor on this machine that a VM could actually be created with?
//
// Split out of `vm-commands.ts` because two consumers need it — `vm spawn`
// (fail-fast before leasing) and `vm status` (report every hypervisor,
// including the ones that are absent) — and because a command file that both
// registers commands and answers host questions is the shape this repo keeps
// paying for in `max-lines` findings.
//
// Detection is a real probe, not a platform guess: the binary must answer
// `--version`, and for KVM the kernel device node must exist. That means the
// answer can change between two calls (an operator installs libvirt mid-run),
// which is exactly why `vm status` reports it instead of caching it.

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import type { VmHypervisor } from '../../services/vm/vm-lease.js';

export type HypervisorProbeRow = {
  readonly hypervisor: VmHypervisor;
  readonly binary: string;
  readonly available: boolean;
  /** The version line when available; why not when it is not. */
  readonly detail: string;
};

/** Every hypervisor the CLI can dispatch to, and the binary it shells out to. */
export const VM_HYPERVISOR_BINARIES: ReadonlyArray<{
  hypervisor: VmHypervisor;
  binary: string;
}> = [
  { hypervisor: 'kvm', binary: 'virsh' },
  { hypervisor: 'hyperkit', binary: 'hvftool' },
  { hypervisor: 'hyperv', binary: 'hvc' }
];

export function binaryForHypervisor(requested: VmHypervisor): string {
  const entry = VM_HYPERVISOR_BINARIES.find((row) => row.hypervisor === requested);
  if (entry === undefined) {
    throw new Error(`unknown hypervisor: ${requested}`);
  }
  return entry.binary;
}

/**
 * Is this hypervisor usable here right now? `kvm` needs both the libvirt CLI
 * and the kernel device node; the others need their binary to answer.
 */
export function detectHypervisor(
  requested: VmHypervisor
): { ok: true; binary: string } | { ok: false; stderr: string } {
  const binary = binaryForHypervisor(requested);
  try {
    const version = execSync(`${binary} --version`, {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      windowsHide: true
    });
    if (requested === 'kvm' && !existsSync('/dev/kvm')) {
      return { ok: false, stderr: 'KVM kernel module not loaded (/dev/kvm absent)' };
    }
    return { ok: true, binary: `${binary} (${version.trim().split('\n')[0] ?? ''})` };
  } catch (error) {
    const message = (error as Error).message;
    // A binary that is not installed fails at exec time, and on Windows that
    // error arrives in the console codepage — it renders as mojibake in the
    // terminal. Name the cause instead of quoting it.
    const absent = /not recognized|not found|ENOENT|Command failed/i.test(message);
    return {
      ok: false,
      stderr: absent ? `${binary} is not on PATH` : (message.split('\n')[0] ?? '')
    };
  }
}

/** Probe every dispatchable hypervisor, in the order the CLI lists them. */
export function probeHypervisors(): HypervisorProbeRow[] {
  return VM_HYPERVISOR_BINARIES.map((entry) => {
    const detected = detectHypervisor(entry.hypervisor);
    return detected.ok
      ? {
          hypervisor: entry.hypervisor,
          binary: entry.binary,
          available: true,
          detail: detected.binary
        }
      : {
          hypervisor: entry.hypervisor,
          binary: entry.binary,
          available: false,
          detail: detected.stderr
        };
  });
}
