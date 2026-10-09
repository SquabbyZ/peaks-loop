import { execSync } from 'node:child_process';

import { findProjectRoot } from '../../services/config/config-safety.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';

export const DEFAULT_DOCKER_IMAGE = 'node:22-slim';

/**
 * runtime adapter. The container CLI supports both docker and
 * podman as the underlying runtime. The auto-detect order is:
 *   1. `--runtime docker|podman` if explicit
 *   2. docker (most common, ships with Docker Desktop on
 *      macOS/Windows, docker.io on Linux)
 *   3. podman (RHEL/Fedora default, runs rootless by default,
 *      same CLI surface as docker)
 * Each runtime has the same spawn/release shape; the
 * difference is the binary name (`docker` vs `podman`). The
 * `--cidfile` flag is supported by both.
 */
export type ContainerRuntime = 'docker' | 'podman';

/** A runtime that answered `--version`, or the reason none did. */
export type ContainerRuntimeProbe =
  | { ok: true; runtime: ContainerRuntime; binary: string }
  | { ok: false; stderr: string; hint: string };

export function detectContainerRuntime(
  explicit: ContainerRuntime | undefined
): ContainerRuntimeProbe {
  const tryOrder: ContainerRuntime[] = explicit ? [explicit] : ['docker', 'podman'];
  for (const r of tryOrder) {
    try {
      const version = execSync(`${r} --version`, {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        windowsHide: true
      }).trim();
      return { ok: true, runtime: r, binary: `${r} (${version.split('\n')[0] ?? ''})` };
    } catch {
      /* try next */
    }
  }
  return {
    ok: false,
    stderr: explicit
      ? `explicit --runtime ${explicit} not on PATH`
      : 'neither docker nor podman is on PATH',
    hint: explicit
      ? `Install ${explicit} or pass a different --runtime.`
      : 'Install docker (Docker Desktop on macOS / Windows) or podman (RHEL / Fedora).'
  };
}

export type ContainerOptions = {
  session?: string;
  project?: string;
  json?: boolean;
};

export type SpawnOptions = ContainerOptions & {
  rid: string;
  role: string;
  purpose: string;
  image?: string;
  ttl?: string;
  mount?: string;
  /** Part 43: explicit runtime selector (docker | podman). */
  runtime?: string;
};

export type ReleaseOptions = ContainerOptions & {
  leaseId: string;
};

export function joinPathSession(projectRoot: string, sessionId: string): string {
  return `${projectRoot.replace(/[\\/]+$/, '')}/.peaks/_runtime/${sessionId}`;
}

/**
 * Resolve the project root and session id every container verb works against.
 * The sid falls back through `PEAKS_SESSION_ID` and the canonical binding
 * before the `unknown-sid` sentinel.
 */
export function resolveContainerTarget(options: ContainerOptions): {
  projectRoot: string;
  sessionId: string;
} {
  const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
  const sessionId =
    options.session ??
    process.env.PEAKS_SESSION_ID ??
    getCurrentSessionId(projectRoot) ??
    'unknown-sid';
  return { projectRoot, sessionId };
}

export function checkDockerAvailable():
  { ok: true; version: string } | { ok: false; stderr: string } {
  // Part 43: superseded by detectContainerRuntime above; this
  // function is preserved for callers that imported it. The
  // container-commands.ts action handlers all use
  // detectContainerRuntime directly.
  return { ok: false, stderr: 'deprecated — use detectContainerRuntime' };
}
