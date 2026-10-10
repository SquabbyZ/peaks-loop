// tests/unit/cli/commands/container-docker-boundary.test.ts
//
// WHY THIS FILE EXISTS — `qa/slice2-equivalence-review.md` F1 proved the slice-2
// equivalence evidence cannot see a function body: it renamed the envelope field
// `dockerRmFailed` to `dockerRemoved` inside `releaseLease`, dropped `--force`
// from its `docker rm`, and both hashes stayed green, because request 016 §6
// declares the `docker rm` + lease-rewrite path "not driven" — and declares the
// same for `container spawn`'s `docker run`.
//
// This file turns those two readings into runs. The `child_process` boundary is
// INJECTED — no docker daemon, no container, no subprocess — and what is asserted
// is the observable output: the exact argv the adapter hands the runtime, and the
// envelope the caller reads.
//
// Dimensions covered — render: the JSON envelope (`dockerRmFailed`,
// `lease.status`). behavior: the `docker rm` argv, the `docker run` argv, the
// on-disk lease transition, the non-fatal-rm contract. integration: a real temp
// project root, a real lease file on disk, a real commander registration; only
// `execSync` is injected. a11y: the warning a human reads when `docker rm`
// failed, and the next-action line that replaces "container removed".

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { makeCapturedIo } from '../../_setup/io.js';
import { withTmpWorkspacePerTest, type TmpWorkspace } from '../../_setup/tmp-workspace.js';

declareDimensions('tests/unit/cli/commands/container-docker-boundary.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

/**
 * The injected runtime. `execSync` never runs a process: every call is recorded
 * and answered from here, which is what makes the two declared-undriven paths
 * reachable without docker.
 */
const runtime = vi.hoisted(() => ({
  calls: [] as Array<{ cmd: string; opts: Record<string, unknown> }>,
  /** `docker rm` fails, simulating a container that is already gone. */
  rmThrows: false,
  /** Stands in for the `--cidfile` docker would write; null = never wrote one. */
  cidContents: null as string | null
}));

/** The real `node:child_process` surface, without naming it through `import()`. */
type ChildProcessModule = {
  execSync: (cmd: string, opts?: Record<string, unknown>) => string;
  spawn: unknown;
  spawnSync: unknown;
};

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<ChildProcessModule>();
  return {
    ...actual,
    // `spawn` / `spawnSync` stay REAL — the container family only uses execSync,
    // and leaving the rest intact keeps the mock from reaching past its target.
    execSync: (cmd: string, opts: Record<string, unknown> = {}): string => {
      runtime.calls.push({ cmd, opts });
      const cid = /--cidfile "([^"]+)"/.exec(cmd);
      if (cid && runtime.cidContents !== null) {
        // Real docker writes the cidfile; the parent directory is the session
        // runtime dir the spawn verb also needs for the lease file.
        mkdirSync(dirname(cid[1] as string), { recursive: true });
        writeFileSync(cid[1] as string, runtime.cidContents);
      }
      if (runtime.rmThrows && cmd.includes(' rm ')) {
        throw new Error('Error response from daemon: No such container');
      }
      return 'Docker version 27.0.0, build abcdef\n';
    }
  };
});

const useWorkspace = withTmpWorkspacePerTest('peaks-container-boundary-');

const SESSION = '2026-10-10-session-container-boundary';
const LEASE_ID = 'a1b2c3d4e5f60718';
const CONTAINER_ID = 'cid-9f8e7d6c5b4a';

afterEach(() => {
  runtime.calls.length = 0;
  runtime.rmThrows = false;
  runtime.cidContents = null;
  // The verbs under test set this on their refusal paths; a leak would make the
  // next file's exit-code assertion pass for the wrong reason.
  process.exitCode = undefined;
});

/** The lease file the release verb must find, at the path the verb computes. */
function leasePath(ws: TmpWorkspace, leaseId = LEASE_ID): string {
  return join(ws.path, '.peaks', '_runtime', SESSION, 'container-leases', `${leaseId}.json`);
}

function writeLease(
  ws: TmpWorkspace,
  overrides: Record<string, unknown> = {},
  leaseId = LEASE_ID
): void {
  const file = leasePath(ws, leaseId);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify(
      {
        leaseId,
        rid: '016',
        role: 'rd',
        path: ws.path,
        image: 'node:22-slim',
        containerId: CONTAINER_ID,
        createdAt: 1_700_000_000_000,
        expiresAt: 4_100_000_000_000,
        purpose: 'container-docker-boundary test',
        status: 'active',
        consumedBySubAgents: [],
        ...overrides
      },
      null,
      2
    ),
    'utf8'
  );
}

function readLease(ws: TmpWorkspace, leaseId = LEASE_ID): Record<string, unknown> {
  return JSON.parse(readFileSync(leasePath(ws, leaseId), 'utf8')) as Record<string, unknown>;
}

/** The `docker rm` the adapter ran, or null when it ran none. */
function rmCall(): { cmd: string; opts: Record<string, unknown> } | undefined {
  return runtime.calls.find((c) => c.cmd.includes(' rm '));
}

function runOfCalls(): string[] {
  return runtime.calls.filter((c) => c.cmd.includes(' run ')).map((c) => c.cmd);
}

async function driveRelease(ws: TmpWorkspace, leaseId = LEASE_ID): Promise<Record<string, unknown>> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  const { registerContainerReleaseCommand } = await import(
    '~/src/cli/commands/container-release-command.js'
  );
  registerContainerReleaseCommand(program, io);
  await program.parseAsync([
    'node',
    'peaks',
    'release',
    '--lease-id',
    leaseId,
    '--session',
    SESSION,
    '--project',
    ws.path,
    '--json'
  ]);
  return JSON.parse(captured.text()) as Record<string, unknown>;
}

async function driveSpawn(
  ws: TmpWorkspace
): Promise<{ envelope: Record<string, unknown>; stderr: string }> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  const { registerContainerSpawnCommand } = await import(
    '~/src/cli/commands/container-spawn-command.js'
  );
  registerContainerSpawnCommand(program, io);
  await program.parseAsync([
    'node',
    'peaks',
    'spawn',
    '--rid',
    '016',
    '--role',
    'rd',
    '--purpose',
    'container-docker-boundary test',
    '--session',
    SESSION,
    '--project',
    ws.path,
    '--json'
  ]);
  return { envelope: JSON.parse(captured.text()) as Record<string, unknown>, stderr: captured.stderrText() };
}

describe('Scenario: behavior — `container release` drives the real `docker rm`', () => {
  it('when an active lease is released, should run `docker rm --force` on that container id', async () => {
    // given: an active lease on disk and a runtime that answers
    const ws = useWorkspace();
    writeLease(ws);

    // when: `peaks container release --lease-id <id>` runs
    const envelope = await driveRelease(ws);

    // then: the exact argv reaches the runtime, unquoted-altered and forced
    const rm = rmCall();
    expect(rm?.cmd).toBe(`docker rm --force "${CONTAINER_ID}"`);
    expect(rm?.opts.cwd).toBe(ws.path);
    expect(rm?.opts.stdio).toBe('pipe');
    expect(rm?.opts.windowsHide).toBe(true);
    expect(envelope.ok).toBe(true);
  });

  it('when the release succeeds, should report `dockerRmFailed: false` and flip the lease on disk', async () => {
    // given: an active lease on disk
    const ws = useWorkspace();
    writeLease(ws);

    // when: the release runs
    const envelope = await driveRelease(ws);

    // then: the envelope names the rm outcome and the lease file is rewritten
    const data = envelope.data as Record<string, unknown>;
    expect(data.dockerRmFailed).toBe(false);
    expect((data.lease as Record<string, unknown>).status).toBe('released');
    expect(readLease(ws).status).toBe('released');
  });

  it('when `docker rm` fails, should still mark the lease released and say so on both channels', async () => {
    // given: a runtime whose `docker rm` fails (the container is already gone)
    const ws = useWorkspace();
    writeLease(ws);
    runtime.rmThrows = true;

    // when: the release runs
    const envelope = await driveRelease(ws);

    // then: the failure is reported, not fatal — the lease is still released
    const data = envelope.data as Record<string, unknown>;
    expect(envelope.ok).toBe(true);
    expect(data.dockerRmFailed).toBe(true);
    expect(readLease(ws).status).toBe('released');
    expect(envelope.warnings).toEqual([
      'docker rm failed (likely the container was already removed); lease marked released.'
    ]);
    expect(envelope.nextActions).toContain('Manual `docker ps -a` + `docker rm` may be needed.');
  });

  it('when the lease is already released, should not run `docker rm` at all', async () => {
    // given: a lease already in the terminal `released` state
    const ws = useWorkspace();
    writeLease(ws, { status: 'released' });

    // when: the release runs again (the verb is documented idempotent)
    const envelope = await driveRelease(ws);

    // then: the runtime is untouched and the envelope says why
    expect(rmCall()).toBeUndefined();
    expect((envelope.data as Record<string, unknown>).alreadyReleased).toBe(true);
  });
});

describe('Scenario: behavior — `container spawn` drives the real `docker run`', () => {
  it('when a lease is spawned, should run `docker run --rm -d` with the cidfile, labels and mount', async () => {
    // given: a runtime that writes the `--cidfile` the way docker does
    const ws = useWorkspace();
    runtime.cidContents = CONTAINER_ID;

    // when: `peaks container spawn` runs
    const { envelope } = await driveSpawn(ws);

    // then: the exact argv reaches the runtime
    const runs = runOfCalls();
    expect(runs).toHaveLength(1);
    const written = readLease(ws, (envelope.data as { lease: { leaseId: string } }).lease.leaseId);
    const run = runs[0] as string;
    expect(run).toContain('docker run --rm -d');
    expect(run).toContain('--cidfile "');
    expect(run).toContain(`--label "peaks.leaseId=${String(written.leaseId)}"`);
    expect(run).toContain('--label "peaks.rid=016"');
    expect(run).toContain(`-v "${ws.path}:/work"`);
    expect(run).toContain('-w /work node:22-slim sleep infinity');
    expect(envelope.ok).toBe(true);
  });

  it('when the spawn succeeds, should write the lease with the container id read back from the cidfile', async () => {
    // given: a runtime that reports `cid-9f8e7d6c5b4a` through the cidfile
    const ws = useWorkspace();
    runtime.cidContents = CONTAINER_ID;

    // when: the spawn runs
    const { envelope } = await driveSpawn(ws);

    // then: the lease on disk carries that id and is active
    const data = envelope.data as Record<string, unknown>;
    const lease = data.lease as Record<string, unknown>;
    expect(lease.containerId).toBe(CONTAINER_ID);
    expect(lease.status).toBe('active');
    expect(readLease(ws, String(lease.leaseId)).containerId).toBe(CONTAINER_ID);
  });
});
