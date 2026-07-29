/**
 * `peaks container spawn | release` — slice 2026-07-29-worktree-l2-extended Part 12.
 *
 * L4 container isolation bridge: Part 8 landed the CLI contract
 * (`peaks sub-agent dispatch --isolation container` is accepted
 * and fail-fasts with ISOLATION_CONTAINER_NOT_YET_IMPLEMENTED).
 * Part 12 implements the spawn/release CLI surface so the
 * dispatch command can shell out to it.
 *
 * This file is the `peaks container` parent command. Sub-commands:
 *   - spawn   : `docker run <image> ...` + write container lease
 *   - release : `docker rm --force <id>` + transition lease to released
 *
 * Runtime requirement: `docker` CLI on PATH. The spawn checks
 * `docker --version` first and returns CONTAINER_RUNTIME_UNAVAILABLE
 * with a remediation hint when the daemon is not running. Windows
 * is supported if Docker Desktop / WSL2 is installed; native podman
 * is a follow-up (the container-lease module is runtime-agnostic).
 *
 * Lease is the source of truth: the dispatch record (v3) carries
 * the leaseId; the PreToolUse gate (Part 2.B pattern) will read
 * PEAKS_CONTAINER_LEASE_ID and consult the lease file before
 * allowing docker-related tool calls. The gate bridge is a
 * follow-up rid.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { fail, getErrorMessage, ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';
import { atomicWriteJson } from '../../services/ide/shared/atomic-json.js';
import {
  containerLeaseFilePath,
  deserializeContainerLease,
  finalizeContainerLease,
  generateContainerLeaseId,
  markContainerReleased,
  ttlForContainerRole,
  type ContainerLease
} from '../../services/container/container-lease.js';

const DEFAULT_DOCKER_IMAGE = 'node:22-slim';

type ContainerOptions = {
  session?: string;
  project?: string;
  json?: boolean;
};

type SpawnOptions = ContainerOptions & {
  rid: string;
  role: string;
  purpose: string;
  image?: string;
  ttl?: string;
  mount?: string;
};

type ReleaseOptions = ContainerOptions & {
  leaseId: string;
};

function joinPathSession(projectRoot: string, sessionId: string): string {
  return `${projectRoot.replace(/[\\/]+$/, '')}/.peaks/_runtime/${sessionId}`;
}

function checkDockerAvailable(): { ok: true; version: string } | { ok: false; stderr: string } {
  try {
    const version = execSync('docker --version', { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
    return { ok: true, version };
  } catch (err) {
    return { ok: false, stderr: (err as Error).message };
  }
}

export function registerContainerCommand(program: Command, io: ProgramIO): void {
  const cmd = program.command('container').description('L4 container isolation: spawn/release container leases (Part 12; pairs with --isolation container on dispatch).');

  addJsonOption(
    cmd.command('spawn')
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
      .option('--ttl <ms>', 'time-to-live in ms (default role-aware; override with positive number)')
      .option('--mount <path>', 'host path to mount as the container working dir (default: <projectRoot>)')
      .option('--session <sid>', 'override session id')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action(async (options: SpawnOptions) => {
    const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const sessionId = options.session ?? process.env.PEAKS_SESSION_ID ?? getCurrentSessionId(projectRoot) ?? 'unknown-sid';
    try {
      const docker = checkDockerAvailable();
      if (!docker.ok) {
        printResult(
          io,
          fail('container.spawn', 'CONTAINER_RUNTIME_UNAVAILABLE', `docker CLI not available: ${docker.stderr}`, { rid: options.rid, role: options.role, sessionId }, [
            'Install Docker (Docker Desktop on macOS / Windows, docker.io on Linux).',
            'On Windows, ensure WSL2 backend is enabled and the daemon is running.',
            'For podman, the container-lease module is runtime-agnostic but the Part 12 CLI uses `docker` literally.'
          ]),
          options.json
        );
        process.exitCode = 1;
        return;
      }

      const leaseId = generateContainerLeaseId();
      const now = Date.now();
      const ttlMs = options.ttl === undefined ? ttlForContainerRole(options.role) : Number.parseInt(options.ttl, 10);
      if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
        printResult(
          io,
          fail('container.spawn', 'INVALID_TTL', '--ttl must be a positive integer (ms)', { ttl: options.ttl }, ['Re-run with --ttl 1800000 (30 min) or omit to use role default.']),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      const image = options.image ?? DEFAULT_DOCKER_IMAGE;
      const mount = options.mount ?? projectRoot;
      // `docker run --rm -d` so the container is detached and
      // auto-removed when stopped; --cidfile writes the
      // container id to a file we can read back. The
      // `--label peaks.leaseId=<id>` lets `peaks container
      // list` / `peaks container gc` find orphans by label
      // when the lease file is missing.
      const cidFile = `${joinPathSession(projectRoot, sessionId).replace(/\\/g, '/')}/.docker-cid-${leaseId}`;
      try {
        execSync(
          `docker run --rm -d --cidfile "${cidFile}" --label "peaks.leaseId=${leaseId}" --label "peaks.rid=${options.rid}" -v "${mount}:/work" -w /work ${image} sleep infinity`,
          { cwd: projectRoot, stdio: 'pipe', encoding: 'utf8' }
        );
      } catch (err) {
        printResult(
          io,
          fail('container.spawn', 'DOCKER_RUN_FAILED', getErrorMessage(err), { rid: options.rid, image, sessionId }, [
            'Verify the image name is reachable on the configured registry.',
            'Verify the host path is mounted correctly (Windows: the path must be visible to WSL2).',
            'Run `docker ps -a` to inspect any leftover containers with the peaks.leaseId label.'
          ]),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      const containerId = readFileSync(cidFile, 'utf8').trim();
      const lease = finalizeContainerLease({
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
            dockerVersion: docker.version,
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
    } catch (err) {
      printResult(
        io,
        fail('container.spawn', 'SPAWN_FAILED', getErrorMessage(err), { rid: options.rid, sessionId }, [
          'See error message; if the lease was not written, retry after fixing the underlying issue.'
        ]),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    cmd.command('release')
      .description('Transition a container lease to released and run `docker rm --force`. Idempotent on already-released leases.')
      .requiredOption('--lease-id <id>', 'lease id returned by `peaks container spawn`')
      .option('--session <sid>', 'override session id')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: ReleaseOptions) => {
    const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const sessionId = options.session ?? process.env.PEAKS_SESSION_ID ?? getCurrentSessionId(projectRoot) ?? 'unknown-sid';
    try {
      const file = containerLeaseFilePath(joinPathSession(projectRoot, sessionId), options.leaseId);
      if (!existsSync(file)) {
        printResult(
          io,
          fail('container.release', 'LEASE_NOT_FOUND', `no lease on disk at ${file}`, { leaseId: options.leaseId, file }, [
            'Run `peaks container list` to inspect active leases.',
            'For a never-spawned lease, this is a no-op — no further action needed.'
          ]),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      let lease: ContainerLease;
      try {
        lease = deserializeContainerLease(readFileSync(file, 'utf8'));
      } catch (err) {
        printResult(
          io,
          fail('container.release', 'LEASE_FILE_INVALID', getErrorMessage(err), { leaseId: options.leaseId, file }, [
            'Delete the malformed lease file manually and re-issue spawn.',
            'For security, release never fails open on a malformed lease.'
          ]),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      if (lease.status === 'released') {
        printResult(
          io,
          ok('container.release', { lease, sessionId, projectRoot, alreadyReleased: true }, [], [`Lease ${lease.leaseId} already released; nothing to do.`]),
          options.json
        );
        return;
      }
      let dockerRmFailed = false;
      try {
        execSync(`docker rm --force "${lease.containerId}"`, { cwd: projectRoot, stdio: 'pipe', encoding: 'utf8' });
      } catch {
        dockerRmFailed = true;
      }
      const released = markContainerReleased(lease);
      atomicWriteJson(file, released);
      printResult(
        io,
        ok(
          'container.release',
          { lease: released, sessionId, projectRoot, dockerRmFailed },
          dockerRmFailed ? ['docker rm failed (likely the container was already removed); lease marked released.'] : [],
          [
            `Lease ${lease.leaseId} marked released.`,
            dockerRmFailed ? 'Manual `docker ps -a` + `docker rm` may be needed.' : `Container ${lease.containerId} removed.`
          ]
        ),
        options.json
      );
    } catch (err) {
      printResult(
        io,
        fail('container.release', 'RELEASE_FAILED', getErrorMessage(err), { leaseId: options.leaseId, sessionId }, [
          'Verify the lease id and re-run.',
          'If the lease was never spawned, no-op.'
        ]),
        options.json
      );
      process.exitCode = 1;
    }
  });
}
