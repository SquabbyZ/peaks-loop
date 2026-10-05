// tests/unit/cli/vm-status-probe.test.ts
//
// rid-VM-001 — `peaks vm status`, the host probe.
//
// `peaks sub-agent dispatch --isolation vm` refuses with
// ISOLATION_VM_NOT_YET_IMPLEMENTED, and `peaks vm spawn` refuses with
// VM_RUNTIME_UNAVAILABLE, but neither told the caller WHICH prerequisite is
// missing on THIS machine: a hypervisor binary (`virsh` / `hvftool` / the
// operator-installed `hvc` shim), the KVM device node, or a host that has no
// hypervisor at all. The caller had to guess, and the only way to learn was to
// run a spawn that was going to fail.
//
// So: a read-only probe that reports each hypervisor's availability and names
// the remediation per platform. It ships no VM runtime — that is a multi-slice
// subsystem (image, `vm exec`, per-OS bindings) — and the probe says so rather
// than letting `peaks vm` look like it works.
//
// What is mocked and why: nothing. `detectHypervisor` shells `<binary>
// --version` for real, so the probe answers about the host it runs on; the
// assertions are on the SHAPE of the answer (every hypervisor reported, every
// unavailable one explained), not on this machine's specific result.
//
// Dimensions covered:
//   - behavior:    every hypervisor is reported, with a reason when unavailable
//   - render:      the human output and the JSON envelope agree
//   - integration: the registered commander command + real PATH/device probes
//   - a11y:        the text names a remedy and never implies vm dispatch ships
//
// Run with: pnpm vitest run tests/unit/cli/vm-status-probe.test.ts

import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import {
  cleanupTmpWorkspace,
  useTmpWorkspace,
  type TmpWorkspace
} from '../_setup/tmp-workspace.js';

declareDimensions('tests/unit/cli/vm-status-probe.test.ts', [
  'behavior',
  'render',
  'integration',
  'a11y'
]);

import { registerVmCommand } from '../../../src/cli/commands/vm-commands.js';

type CapturedIo = ReturnType<typeof makeCapturedIo>['captured'];

type ProbeRow = {
  hypervisor: string;
  binary: string;
  available: boolean;
  detail?: string;
};

type ProbeEnvelope = {
  ok: boolean;
  command: string;
  code?: string;
  message?: string;
  data: {
    platform: string;
    hypervisors: ProbeRow[];
    anyAvailable: boolean;
  };
  nextActions: string[];
};

async function runVm(
  argv: readonly string[]
): Promise<{ captured: CapturedIo; envelope: ProbeEnvelope }> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  registerVmCommand(program, io);
  await program.parseAsync(['vm', ...argv], { from: 'user' });
  const text = `${captured.stdout.join('\n')}\n${captured.stderr.join('\n')}`;
  const start = text.indexOf('{');
  if (start < 0) throw new Error(`no JSON envelope in output: ${text}`);
  return { captured, envelope: JSON.parse(text.slice(start)) as ProbeEnvelope };
}

async function runVmHuman(argv: readonly string[]): Promise<CapturedIo> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  registerVmCommand(program, io);
  await program.parseAsync(['vm', ...argv], { from: 'user' });
  return captured;
}

let ws: TmpWorkspace;
let savedExitCode: string | number | null | undefined;

beforeEach(() => {
  ws = useTmpWorkspace('peaks-vm-probe-');
  savedExitCode = process.exitCode;
  process.exitCode = 0;
});

afterEach(() => {
  process.exitCode = savedExitCode;
  cleanupTmpWorkspace();
});

describe('peaks vm status (rid-VM-001) — behavior', () => {
  it('reports every hypervisor the CLI can dispatch to, naming its binary', async () => {
    const { envelope } = await runVm(['status', '--json']);

    const reported = envelope.data.hypervisors.map((row) => row.hypervisor).sort();
    expect(reported).toEqual(['hyperkit', 'hyperv', 'kvm']);
    for (const row of envelope.data.hypervisors) {
      expect(['virsh', 'hvftool', 'hvc']).toContain(row.binary);
      expect(typeof row.available).toBe('boolean');
    }
  });

  it('explains every hypervisor it cannot use, so the caller is not left guessing', async () => {
    const { envelope } = await runVm(['status', '--json']);

    for (const row of envelope.data.hypervisors.filter((candidate) => !candidate.available)) {
      expect((row.detail ?? '').trim().length).toBeGreaterThan(0);
      // The cause is named in one line the user can read. The raw exec error
      // arrives in the console codepage on Windows and renders as mojibake,
      // so it may not be quoted verbatim.
      expect(row.detail).not.toMatch(/\r?\n/);
      expect(row.detail).toMatch(/^[\x20-\x7E]+$/);
    }
  });

  it('agrees with itself about whether anything is usable', async () => {
    const { envelope } = await runVm(['status', '--json']);

    expect(envelope.data.anyAvailable).toBe(envelope.data.hypervisors.some((row) => row.available));
    expect(envelope.data.platform.length).toBeGreaterThan(0);
  });
});

describe('peaks vm status (rid-VM-001) — render', () => {
  it('prints one line per hypervisor plus the platform, in the human path too', async () => {
    const captured = await runVmHuman(['status']);
    const text = captured.stdout.join('\n');

    for (const hypervisor of ['kvm', 'hyperkit', 'hyperv']) {
      expect(text).toMatch(new RegExp(`^${hypervisor}\\s+(present|absent)`, 'm'));
    }
    expect(text).toMatch(/^platform:\s+\S+$/m);
    // The human path must carry the two things a reader acts on: that vm
    // dispatch is still unimplemented, and which modes are live. Asserted on
    // either stream, and not on a code name, so the arm holds on a host where
    // a hypervisor IS present.
    const all = `${text}\n${captured.stderr.join('\n')}`;
    expect(all).toContain('not implemented');
    expect(all).toMatch(/worktree|container/);
  });
});

describe('peaks vm status (rid-VM-001) — integration', () => {
  it('is a read-only probe: it writes no lease and mutates no state', async () => {
    const { captured } = await runVm(['status', '--json']);

    // The probe must not create the runtime directory it reports on.
    expect(captured.stdout.join('\n')).toContain('vm.status');
    expect(existsSync(join(ws.path, '.peaks', '_runtime'))).toBe(false);
  });
});

describe('peaks vm status (rid-VM-001) — a11y', () => {
  it('names what to install, and never claims dispatch --isolation vm works today', async () => {
    const { captured, envelope } = await runVm(['status', '--json']);

    const text = `${captured.stdout.join('\n')}\n${captured.stderr.join('\n')}`;
    expect(envelope.nextActions.join('\n')).toMatch(/worktree|container/);
    expect(text).not.toMatch(/dispatch --isolation vm (?:is|now) (?:available|supported)/i);
    expect(text).toContain('not implemented');
  });
});
