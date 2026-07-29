/**
 * container-lease — pure-function lease store for `peaks container spawn`.
 *
 * Slice 2026-07-29-worktree-l2-extended Part 12 (L4 container
 * runtime). Mirrors the design of `worktree-lease.ts` (Part 1):
 * - Pure function module: every helper takes the lease
 *   directory path as an argument and returns structured data.
 *   Atomic filesystem writes happen at the call site (CLI
 *   command), keeping the helpers trivially testable.
 * - Lifecycle states: active → released/expired/gc, irreversible
 *   once terminal.
 * - The CLI in `src/cli/commands/container-commands.ts` writes
 *   the lease file and runs `docker run` / `docker rm`; the
 *   `peaks sub-agent dispatch --isolation container` command
 *   (Part 8) shells out to the spawn CLI and persists the
 *   leaseId on the dispatch record (v3 schema).
 *
 * Why a separate lease (not reusing the worktree one): the two
 * isolation modes have different lifecycles, different runtime
 * commands, and different env-var hooks for the PreToolUse
 * gate. Reusing the worktree lease would have made the lease
 * file schema bimodal (worktree-or-container in every field).
 * Two thin modules is cleaner than one thick one.
 *
 * Note: container runtime is docker-only for Part 12. podman
 * support (drop-in CLI-compatible for `run` / `rm` / `ps`) is
 * a follow-up; the runtime-agnostic interface lives in
 * container-runtime.ts (next slice).
 */

import { randomBytes } from 'node:crypto';
import { posix as path } from 'node:path';

export const DEFAULT_TTL_BY_ROLE: Readonly<Record<string, number>> = Object.freeze({
  rd: 30 * 60 * 1_000,
  qa: 15 * 60 * 1_000,
  ui: 60 * 60 * 1_000,
  sc: 30 * 60 * 1_000,
  prd: 15 * 60 * 1_000,
  general: 30 * 60 * 1_000
}) as Readonly<Record<string, number>>;

export const DEFAULT_TTL_MS = DEFAULT_TTL_BY_ROLE.rd;

export type ContainerLeaseStatus = 'active' | 'released' | 'expired' | 'gc';

export interface ContainerLease {
  readonly leaseId: string;
  /** The peaks request id (rid) that the lease was spawned for. */
  readonly rid: string;
  /** Sub-agent role (rd | qa | ui | sc | prd | general-purpose | ...). */
  readonly role: string;
  /** Absolute container working dir (mounted into the container). */
  readonly path: string;
  /** Docker image name (e.g. `node:22-slim`). */
  readonly image: string;
  /** Container id reported by `docker run`. */
  readonly containerId: string;
  /** Unix epoch ms when the lease was created. */
  readonly createdAt: number;
  /** Unix epoch ms when the lease expires. */
  readonly expiresAt: number;
  /** Operator-supplied purpose text (audit log). */
  readonly purpose: string;
  readonly status: ContainerLeaseStatus;
  readonly consumedBySubAgents: ReadonlyArray<string>;
}

export type ContainerLeaseDraft = Omit<ContainerLease, 'status' | 'consumedBySubAgents'>;

export function containerLeaseStoreDir(sessionRuntimeDir: string): string {
  return joinPath(sessionRuntimeDir, 'container-leases');
}

export function containerLeaseFilePath(sessionRuntimeDir: string, leaseId: string): string {
  return joinPath(containerLeaseStoreDir(sessionRuntimeDir), `${leaseId}.json`);
}

/** Pure: generate a 16-hex lease id (8 random bytes, hex-encoded). */
export function generateContainerLeaseId(): string {
  return randomBytes(8).toString('hex');
}

export function ttlForContainerRole(role: string): number {
  const normalized = role.toLowerCase();
  const candidate: number | undefined = DEFAULT_TTL_BY_ROLE[normalized];
  const fallback: number = DEFAULT_TTL_BY_ROLE['rd'] ?? 30 * 60 * 1_000;
  return candidate ?? fallback;
}

export function finalizeContainerLease(draft: ContainerLeaseDraft): ContainerLease {
  return {
    ...draft,
    status: 'active',
    consumedBySubAgents: []
  };
}

export function markContainerReleased(lease: ContainerLease): ContainerLease {
  return { ...lease, status: 'released' };
}

export function markContainerExpired(lease: ContainerLease): ContainerLease {
  return { ...lease, status: 'expired' };
}

export function markContainerGc(lease: ContainerLease): ContainerLease {
  return { ...lease, status: 'gc' };
}

export function recordContainerConsumption(lease: ContainerLease, subAgentId: string): ContainerLease {
  if (lease.consumedBySubAgents.includes(subAgentId)) return lease;
  return { ...lease, consumedBySubAgents: [...lease.consumedBySubAgents, subAgentId] };
}

export function isContainerLeaseActive(lease: ContainerLease, now: number = Date.now()): boolean {
  return lease.status === 'active' && lease.expiresAt > now;
}

export function serializeContainerLease(lease: ContainerLease): string {
  return JSON.stringify(lease, null, 2) + '\n';
}

export function deserializeContainerLease(raw: string): ContainerLease {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('container lease file must contain a JSON object');
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.leaseId !== 'string') throw new Error('leaseId missing');
  if (typeof obj.rid !== 'string') throw new Error('rid missing');
  if (typeof obj.role !== 'string') throw new Error('role missing');
  if (typeof obj.path !== 'string') throw new Error('path missing');
  if (typeof obj.image !== 'string') throw new Error('image missing');
  if (typeof obj.containerId !== 'string') throw new Error('containerId missing');
  if (typeof obj.createdAt !== 'number') throw new Error('createdAt missing');
  if (typeof obj.expiresAt !== 'number') throw new Error('expiresAt missing');
  if (typeof obj.purpose !== 'string') throw new Error('purpose missing');
  if (typeof obj.status !== 'string') throw new Error('status missing');
  if (!Array.isArray(obj.consumedBySubAgents)) throw new Error('consumedBySubAgents missing');
  return {
    leaseId: obj.leaseId,
    rid: obj.rid,
    role: obj.role,
    path: obj.path,
    image: obj.image,
    containerId: obj.containerId,
    createdAt: obj.createdAt,
    expiresAt: obj.expiresAt,
    purpose: obj.purpose,
    status: obj.status as ContainerLeaseStatus,
    consumedBySubAgents: obj.consumedBySubAgents as ReadonlyArray<string>
  };
}

function joinPath(...segments: ReadonlyArray<string>): string {
  if (segments.length === 0) return '';
  const normalized = segments.map((s) => s.replace(/\\/g, '/'));
  let acc: string = normalized[0] as string;
  for (let i = 1; i < normalized.length; i++) {
    acc = path.join(acc, normalized[i] as string);
  }
  return acc;
}
