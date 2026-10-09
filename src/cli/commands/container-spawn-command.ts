import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { fail, getErrorMessage, ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { atomicWriteJson } from '../../services/ide/shared/atomic-json.js';
import { normalizePath } from '../../shared/path-utils.js';
import {
  containerLeaseFilePath,
  finalizeContainerLease,
  generateContainerLeaseId,
  ttlForContainerRole,
  type ContainerLease
} from '../../services/container/container-lease.js';
import {
  DEFAULT_DOCKER_IMAGE,
  detectContainerRuntime,
  joinPathSession,
  resolveContainerTarget,
  type ContainerRuntime,
  type ContainerRuntimeProbe,
  type SpawnOptions
} from './container-command-shared.js';

/** Everything the docker-run step needs, once the flags are validated. */
type SpawnPlan = {
  options: SpawnOptions;
  io: ProgramIO;
  projectRoot: string;
  sessionId: string;
  detected: ContainerRuntimeProbe & { ok: true };
  image: string;
  mount: string;
  leaseId: string;
  now: number;
  ttlMs: number;
};

export function registerContainerSpawnCommand(cmd: Command, io: ProgramIO): void {
  addJsonOption(
    cmd
      .command('spawn')
      .description(
        'Spawn a container via `docker run` and write a container lease. ' +
          'The lease is the source of truth for the L4 PreToolUse gate (Part 12 follow-up). ' +
          'Default TTL is role-aware (rd=30m / qa=15m / ui=1h); pass --ttl <ms> to override. ' +
          'Default image is `node:22-slim`; pass --image <name> to override.'
      )
      .requiredOption('--rid <rid>', 'peaks request id the lease is associated with')
      .requiredOption('--role <role>', 'sub-agent role (rd | qa | ui | sc | prd | general-purpose)')
      .requiredOption('--purpose <text>', 'why this container was spawned (audit log)')
      .option('--image <name>', `container image (default ${DEFAULT_DOCKER_IMAGE})`)
      .option(
        '--ttl <ms>',
        'time-to-live in ms (default role-aware; override with positive number)'
      )
      .option(
        '--mount <path>',
        'host path to mount as the container working dir (default: <projectRoot>)'
      )
      .option('--session <sid>', 'override session id')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: SpawnOptions) => runContainerSpawn(io, options));
}

/** The `--runtime` flag, narrowed to the two runtimes the adapter supports. */
function explicitRuntimeOf(options: SpawnOptions): ContainerRuntime | undefined {
  if (options.runtime === 'docker') return 'docker';
  if (options.runtime === 'podman') return 'podman';
  return undefined;
}

/** Refuse `--runtime` when neither binary answers; `null` once refused. */
function requireRuntime(
  options: SpawnOptions,
  io: ProgramIO,
  projectRoot: string,
  sessionId: string
): (ContainerRuntimeProbe & { ok: true }) | null {
  const detected = detectContainerRuntime(explicitRuntimeOf(options));
  if (detected.ok) return detected;
  printResult(
    io,
    fail(
      'container.spawn',
      'CONTAINER_RUNTIME_UNAVAILABLE',
      `${detected.stderr}: ${detected.hint}`,
      { rid: options.rid, role: options.role, sessionId },
      [
        'Install docker (Docker Desktop on macOS / Windows) or podman (RHEL / Fedora).',
        'On Windows, ensure WSL2 backend is enabled and the daemon is running.',
        'Pass --runtime docker|podman to force a specific runtime.'
      ]
    ),
    options.json
  );
  process.exitCode = 1;
  return null;
}

/** Resolve `--ttl`, refusing a non-positive integer; `null` once refused. */
function requireTtl(options: SpawnOptions, io: ProgramIO): number | null {
  const ttlMs =
    options.ttl === undefined
      ? ttlForContainerRole(options.role)
      : Number.parseInt(options.ttl, 10);
  if (Number.isInteger(ttlMs) && ttlMs > 0) return ttlMs;
  printResult(
    io,
    fail(
      'container.spawn',
      'INVALID_TTL',
      '--ttl must be a positive integer (ms)',
      { ttl: options.ttl },
      ['Re-run with --ttl 1800000 (30 min) or omit to use role default.']
    ),
    options.json
  );
  process.exitCode = 1;
  return null;
}

/** The worker root the cidfile lives in; `normalizePath` keeps Windows paths sane. */
function cidFileFor(plan: SpawnPlan): string {
  const root = normalizePath(joinPathSession(plan.projectRoot, plan.sessionId));
  return `${root}/.${plan.detected.runtime}-cid-${plan.leaseId}`;
}

/**
 * `docker run --rm -d` so the container is detached and auto-removed when
 * stopped; `--cidfile` writes the container id to a file we read back. The
 * `--label peaks.leaseId=<id>` lets `peaks container list` / `peaks container gc`
 * find orphans by label when the lease file is missing.
 *
 * Returns the container id, or `null` once DOCKER_RUN_FAILED is emitted.
 */
function runDockerSpawn(plan: SpawnPlan): string | null {
  const { options, io, projectRoot, detected, image, mount } = plan;
  const cidFile = cidFileFor(plan);
  try {
    execSync(
      `${detected.runtime} run --rm -d --cidfile "${cidFile}" --label "peaks.leaseId=${plan.leaseId}" --label "peaks.rid=${options.rid}" -v "${mount}:/work" -w /work ${image} sleep infinity`,
      { cwd: projectRoot, stdio: 'pipe', encoding: 'utf8', windowsHide: true }
    );
  } catch (err) {
    printResult(
      io,
      fail(
        'container.spawn',
        'DOCKER_RUN_FAILED',
        getErrorMessage(err),
        { rid: options.rid, image, runtime: detected.runtime, sessionId: plan.sessionId },
        [
          'Verify the image name is reachable on the configured registry.',
          'Verify the host path is mounted correctly (Windows: the path must be visible to WSL2).',
          `Run \`${detected.runtime} ps -a\` to inspect any leftover containers with the peaks.leaseId label.`
        ]
      ),
      options.json
    );
    process.exitCode = 1;
    return null;
  }
  return readFileSync(cidFile, 'utf8').trim();
}

/** Write the lease and print the success envelope. */
function finishSpawn(plan: SpawnPlan, containerId: string): void {
  const { options, io, projectRoot, sessionId, detected, image, mount, leaseId, now, ttlMs } = plan;
  const lease: ContainerLease = finalizeContainerLease({
    leaseId,
    rid: options.rid,
    role: options.role,
    path: mount,
    image,
    containerId,
    createdAt: now,
    expiresAt: now + ttlMs,
    purpose: options.purpose
  });
  atomicWriteJson(containerLeaseFilePath(joinPathSession(projectRoot, sessionId), leaseId), lease);
  printResult(
    io,
    ok(
      'container.spawn',
      {
        lease,
        sessionId,
        projectRoot,
        runtime: detected.runtime,
        runtimeVersion: detected.binary,
        nextActions: [
          `Container id: ${containerId}`,
          `Image: ${image}`,
          `Lease expires at: ${new Date(lease.expiresAt).toISOString()}`,
          'Run `peaks container release --lease-id <id>` when done'
        ]
      },
      [],
      []
    ),
    options.json
  );
}

function runContainerSpawn(io: ProgramIO, options: SpawnOptions): void {
  const { projectRoot, sessionId } = resolveContainerTarget(options);
  try {
    const detected = requireRuntime(options, io, projectRoot, sessionId);
    if (detected === null) return;
    const ttlMs = requireTtl(options, io);
    if (ttlMs === null) return;
    const plan: SpawnPlan = {
      options,
      io,
      projectRoot,
      sessionId,
      detected,
      image: options.image ?? DEFAULT_DOCKER_IMAGE,
      mount: options.mount ?? projectRoot,
      leaseId: generateContainerLeaseId(),
      now: Date.now(),
      ttlMs
    };
    const containerId = runDockerSpawn(plan);
    if (containerId === null) return;
    finishSpawn(plan, containerId);
  } catch (err) {
    printResult(
      io,
      fail(
        'container.spawn',
        'SPAWN_FAILED',
        getErrorMessage(err),
        { rid: options.rid, sessionId },
        [
          'See error message; if the lease was not written, retry after fixing the underlying issue.'
        ]
      ),
      options.json
    );
    process.exitCode = 1;
  }
}
