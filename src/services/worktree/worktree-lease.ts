/**
 * worktree-lease — pure-function lease store for `peaks worktree spawn`.
 *
 * Slice 2026-07-29-worktree-l2-extended Part 1. This is the Layer 2
 * governance complement to Layer 3 (`permissions.deny` for the superpowers
 * chain) and Layer 1 (sub-agent dispatch prompt refusal). Together the
 * three layers close the superpowers-chain jailbreak that previously
 * bypassed peaks-loop's worktree posture.
 *
 * The store is a pure function module: every helper takes the lease
 * directory path as an argument and returns structured data. Atomic
 * filesystem writes happen at the call site (CLI command), keeping the
 * helpers trivially testable. The CLI surface lives in
 * `src/cli/commands/worktree-spawn-commands.ts`.
 *
 * Why a separate lease (vs reusing `peaks worktree auth grant`):
 * - `auth grant` is a single-shot, short-lived token file consulted by
 *   the PreToolUse hook BEFORE `git worktree add` runs. It answers
 *   "is the LLM allowed to do this right now?"
 * - `lease` is a long-lived lifecycle object that owns the worktree
 *   path, branch, expiry, and consumption log. It answers
 *   "what worktrees does this session own, and which are still alive?"
 * The two coexist: `spawn` writes a lease; the lease's existence
 * implicitly authorizes worktree operations on its path (the hook
 * integration is Part 2 of this slice).
 */

import { randomBytes } from 'node:crypto';
import { posix as path } from 'node:path';
import { normalizePath } from '../../shared/path-utils.js';

/**
 * Per-role default TTL. Sub-agent dispatch duration varies by role:
 * - rd (long planning + impl) → 30 min
 * - qa (test design + browser validation) → 15 min
 * - ui (high-fidelity prototype iteration) → 1 h
 * - txt (handoff capsule, no worktree expected) → n/a (no worktree)
 * - general-purpose / unknown → 30 min (rd-like)
 *
 * Users MAY override with `--ttl <duration>` (e.g. `--ttl 4h`).
 */
// PRD-002b slice 2 — extract lease-TTL primitives (same shape as
// container-lease.ts / vm-lease.ts). See config diff comment.
const MINUTES_PER_HOUR = 60;
const MS_PER_MINUTE = MINUTES_PER_HOUR * 1_000;
const LEASE_RD_TTL_MINUTES = 30;
const LEASE_QA_TTL_MINUTES = 15;
const LEASE_UI_TTL_MINUTES = MINUTES_PER_HOUR;
const LEASE_SC_TTL_MINUTES = 30;
const LEASE_PRD_TTL_MINUTES = 15;
const LEASE_GENERAL_TTL_MINUTES = 30;
const LEASE_ID_RANDOM_BYTES = 8;

export const DEFAULT_TTL_BY_ROLE: Readonly<Record<string, number>> = Object.freeze({
  rd: LEASE_RD_TTL_MINUTES * MS_PER_MINUTE,
  qa: LEASE_QA_TTL_MINUTES * MS_PER_MINUTE,
  ui: LEASE_UI_TTL_MINUTES * MS_PER_MINUTE,
  sc: LEASE_SC_TTL_MINUTES * MS_PER_MINUTE,
  prd: LEASE_PRD_TTL_MINUTES * MS_PER_MINUTE,
  general: LEASE_GENERAL_TTL_MINUTES * MS_PER_MINUTE
}) as Readonly<Record<string, number>>;

export const DEFAULT_TTL_MS = DEFAULT_TTL_BY_ROLE.rd;

export type WorktreeLeaseStatus = 'active' | 'released' | 'expired' | 'gc';

export interface WorktreeLease {
  /** Random 16-hex lease id; emitted to the operator as the lease handle. */
  readonly leaseId: string;
  /** The peaks request id (rid) that the lease was spawned for. */
  readonly rid: string;
  /** Sub-agent role (rd | qa | ui | sc | prd | general-purpose | ...). */
  readonly role: string;
  /** Absolute worktree path on disk (under .peaks/_runtime/<sid>/worktrees/<leaseId>/). */
  readonly path: string;
  /** Branch name (one of the worktree's --branch / -b args). */
  readonly branch: string;
  /** Unix epoch ms when the lease was created. */
  readonly createdAt: number;
  /** Unix epoch ms when the lease expires. */
  readonly expiresAt: number;
  /** Operator-supplied purpose text (audit log). */
  readonly purpose: string;
  /** Lifecycle status; updated by `releaseLease` / `markExpired`. */
  readonly status: WorktreeLeaseStatus;
  /** Sub-agent batch / dispatch ids that have consumed this lease. */
  readonly consumedBySubAgents: ReadonlyArray<string>;
}

/** Subset of WorktreeLease that the CLI writes on creation. Status starts at 'active'. */
export type WorktreeLeaseDraft = Omit<WorktreeLease, 'status' | 'consumedBySubAgents'>;

/**
 * Compose a deterministic lease path under the per-session runtime dir.
 * The function is pure: same inputs → same output. The caller passes
 * `<sessionId>` (NOT a bare `<sid>` per the 2.7.1 single-scope-axis rule).
 *
 * Path layout:
 *   .peaks/_runtime/<sessionId>/worktree-leases/<leaseId>.json
 *
 * The `worktree-leases/` directory is gitignored per the .peaks/_runtime/
 * rule (committed in .gitignore for all runtime artifacts).
 */
export function leaseStoreDir(sessionRuntimeDir: string): string {
  return joinPath(sessionRuntimeDir, 'worktree-leases');
}

export function leaseFilePath(sessionRuntimeDir: string, leaseId: string): string {
  return joinPath(leaseStoreDir(sessionRuntimeDir), `${leaseId}.json`);
}

/**
 * Compose the absolute worktree path (the `git worktree add <path>` target).
 * Sits adjacent to the lease file under the same runtime dir.
 */
export function worktreePath(sessionRuntimeDir: string, leaseId: string): string {
  return joinPath(sessionRuntimeDir, 'worktrees', leaseId);
}

/**
 * Generate a 16-hex lease id (8 random bytes, hex-encoded). The id is
 * unique enough for the per-session scope; collisions across sessions
 * are irrelevant because each session has its own lease directory.
 */
export function generateLeaseId(): string {
  return randomBytes(LEASE_ID_RANDOM_BYTES).toString('hex');
}

/**
 * Compute the TTL ms for a role, falling back to DEFAULT_TTL_MS for
 * unknown roles. The CLI overrides with `--ttl <ms>` when the user
 * passes a positive value.
 */
export function ttlForRole(role: string): number {
  const normalized = role.toLowerCase();
  const candidate: number | undefined = DEFAULT_TTL_BY_ROLE[normalized];
  const fallback: number = DEFAULT_TTL_BY_ROLE['rd'] ?? LEASE_RD_TTL_MINUTES * MS_PER_MINUTE;
  return candidate ?? fallback;
}

/**
 * Pure: produce a fresh `WorktreeLease` from a draft + status.
 * `status` defaults to `'active'`; `consumedBySubAgents` defaults to [].
 * Used by the CLI's atomicWriteJson call.
 */
export function finalizeLease(
  draft: WorktreeLeaseDraft
): WorktreeLease {
  return {
    ...draft,
    status: 'active',
    consumedBySubAgents: []
  };
}

/** Pure: lease status transitions to 'released'. Returns a new lease. */
export function markReleased(lease: WorktreeLease): WorktreeLease {
  return { ...lease, status: 'released' };
}

/** Pure: lease status transitions to 'expired'. Returns a new lease. */
export function markExpired(lease: WorktreeLease): WorktreeLease {
  return { ...lease, status: 'expired' };
}

/** Pure: lease status transitions to 'gc'. Returns a new lease. */
export function markGc(lease: WorktreeLease): WorktreeLease {
  return { ...lease, status: 'gc' };
}

/** Pure: append a sub-agent batch / dispatch id to the consumption log. Returns a new lease. */
export function recordConsumption(
  lease: WorktreeLease,
  subAgentId: string
): WorktreeLease {
  if (lease.consumedBySubAgents.includes(subAgentId)) return lease;
  return { ...lease, consumedBySubAgents: [...lease.consumedBySubAgents, subAgentId] };
}

/**
 * Pure: is the lease still active (status === 'active' AND not past expiry).
 * Expired leases are NOT auto-released; the gc CLI is the only path that
 * transitions them to 'gc'. Until then, the on-disk state stays 'active'
 * but `isLeaseActive` returns false so consumers skip the lease.
 */
export function isLeaseActive(lease: WorktreeLease, now: number = Date.now()): boolean {
  return lease.status === 'active' && lease.expiresAt > now;
}

/**
 * Pure: read every lease file under the session's lease store dir.
 * Returns leases in the order returned by `fs.readdir` (no sort).
 * Malformed files are surfaced as `{ file, error }` records so the caller
 * (the `list` CLI) can warn without aborting the whole list. Missing
 * directory is not an error — it returns an empty leases array.
 */
export interface LeaseReadError {
  readonly file: string;
  readonly error: string;
}
export type LeaseListResult =
  | { readonly kind: 'ok'; readonly leases: ReadonlyArray<WorktreeLease>; readonly errors: ReadonlyArray<LeaseReadError> }
  | { readonly kind: 'store-missing'; readonly storeDir: string };

/**
 * List every lease file under the session's lease store dir.
 *
 * Pure with respect to its inputs: it does NOT sort or filter, and it
 * does NOT mark anything expired. Callers (the `list` CLI) apply their
 * own sort/filter and run `markExpired` lazily.
 */
export function listLeasesSync(storeDir: string, fs: {
  readdir: (path: string) => ReadonlyArray<string>;
  readFile: (path: string) => string;
  existsSync: (path: string) => boolean;
}): LeaseListResult {
  if (!fs.existsSync(storeDir)) {
    return { kind: 'store-missing', storeDir };
  }
  const files = fs.readdir(storeDir).filter((f) => f.endsWith('.json'));
  const leases: WorktreeLease[] = [];
  const errors: LeaseReadError[] = [];
  for (const f of files) {
    const file = `${storeDir.replace(/[\\/]+$/, '')}/${f}`;
    try {
      leases.push(deserializeLease(fs.readFile(file)));
    } catch (err) {
      errors.push({ file, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { kind: 'ok', leases, errors };
}

/**
 * Pure: a lease is eligible for `gc` if its status is one of {released,
 * expired} AND its worktree path is no longer attached to git (`git
 * worktree list` would not include it). The CLI re-checks with git and
 * uses this helper as a coarse pre-filter.
 */
export function isLeaseGcEligible(lease: WorktreeLease, now: number = Date.now()): boolean {
  if (lease.status === 'gc') return false;
  if (lease.status === 'released') return true;
  // status === 'active' but past expiry → treat as expired candidate
  return lease.expiresAt <= now;
}

/**
 * Pure: derive a new lease from an existing one with an extended
 * `expiresAt`. Other fields are preserved. The CLI writes the new lease
 * atomically. Used by `peaks worktree renew --lease-id <id> --ttl <ms>`.
 */
export function renewLease(lease: WorktreeLease, newExpiresAt: number): WorktreeLease {
  return { ...lease, expiresAt: newExpiresAt, status: 'active' };
}

/**
 * Pure: serialize a lease to JSON with stable field order (deterministic
 * output for diff-friendly audit logs). The CLI passes the result to
 * `atomicWriteJson`. The function does NOT mutate the input.
 */
export function serializeLease(lease: WorktreeLease): string {
  return JSON.stringify(lease, null, 2) + '\n';
}

/**
 * Pure: deserialize a lease from JSON. Throws on malformed input — the
 * CLI catches and returns a `LEASE_FILE_INVALID` envelope (mirroring the
 * `peaks worktree auth` FILE_INVALID convention).
 */
export function deserializeLease(raw: string): WorktreeLease {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('lease file must contain a JSON object');
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.leaseId !== 'string') throw new Error('leaseId missing');
  if (typeof obj.rid !== 'string') throw new Error('rid missing');
  if (typeof obj.role !== 'string') throw new Error('role missing');
  if (typeof obj.path !== 'string') throw new Error('path missing');
  if (typeof obj.branch !== 'string') throw new Error('branch missing');
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
    branch: obj.branch,
    createdAt: obj.createdAt,
    expiresAt: obj.expiresAt,
    purpose: obj.purpose,
    status: obj.status as WorktreeLeaseStatus,
    consumedBySubAgents: obj.consumedBySubAgents as ReadonlyArray<string>
  };
}

/** Internal: normalize a path segment to forward slashes (Windows
 *  callers pass `C:\Users\...`; posix.join sees the backslash and
 *  silently mangles). Then posix-join. The CLI uses the same module
 *  so reads + writes always agree. */
function joinPath(...segments: ReadonlyArray<string>): string {
  if (segments.length === 0) return '';
  const normalized = segments.map((s) => normalizePath(s));
  let acc: string = normalized[0] as string;
  for (let i = 1; i < normalized.length; i++) {
    acc = path.join(acc, normalized[i] as string);
  }
  return acc;
}