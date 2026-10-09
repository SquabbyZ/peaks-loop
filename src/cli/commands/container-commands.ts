/**
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

import type { Command } from 'commander';

import type { ProgramIO } from '../cli-helpers.js';
import { registerContainerReleaseCommand } from './container-release-command.js';
import { registerContainerSpawnCommand } from './container-spawn-command.js';

export function registerContainerCommand(program: Command, io: ProgramIO): void {
  const cmd = program
    .command('container')
    .description(
      'L4 container isolation: spawn/release container leases (Part 12; pairs with --isolation container on dispatch).'
    );

  registerContainerSpawnCommand(cmd, io);
  registerContainerReleaseCommand(cmd, io);
}
