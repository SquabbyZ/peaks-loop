/**
 * worktree-lease store — pure-function lease records for `peaks worktree spawn`.
 *
 * The store is a pure module: every helper takes the lease directory path as an
 * argument and returns structured data. Filesystem writes happen at the call
 * site (`lifecycle.ts` takes them through an injected `fs`), which keeps these
 * helpers trivially testable. Time and randomness are parameters with
 * production defaults, so a caller can make a run deterministic; a caller that
 * wants them can also leave them alone.
 *
 * Why a separate lease (vs reusing `peaks worktree auth grant`):
 * - `auth grant` is a single-shot, short-lived token file consulted by the
 *   PreToolUse hook BEFORE `git worktree add` runs. It answers
 *   "is the LLM allowed to do this right now?"
 * - `lease` is a long-lived lifecycle object that owns the worktree path,
 *   branch, expiry, and consumption log. It answers
 *   "what worktrees does this session own, and which are still alive?"
 */

import { randomBytes as cryptoRandomBytes } from 'node:crypto';
import { posix as path } from 'node:path';
import type {
  LeaseListResult,
  LeaseReadError,
  WorktreeLease,
  WorktreeLeaseDraft,
  WorktreeLeaseStatus
} from './types.js';

export type {
  LeaseListResult,
  LeaseReadError,
  WorktreeLease,
  WorktreeLeaseDraft,
  WorktreeLeaseStatus
} from './types.js';

const MINUTES_PER_HOUR = 60;
const MS_PER_MINUTE = MINUTES_PER_HOUR * 1_000;
const LEASE_RD_TTL_MINUTES = 30;
const LEASE_QA_TTL_MINUTES = 15;
const LEASE_UI_TTL_MINUTES = MINUTES_PER_HOUR;
const LEASE_SC_TTL_MINUTES = 30;
const LEASE_PRD_TTL_MINUTES = 15;
const LEASE_GENERAL_TTL_MINUTES = 30;
const LEASE_ID_RANDOM_BYTES = 8;

/**
 * Per-role default TTL. Sub-agent dispatch duration varies by role:
 * - rd (long planning + impl) → 30 min
 * - qa (test design + browser validation) → 15 min
 * - ui (high-fidelity prototype iteration) → 1 h
 * - general / unknown → 30 min (rd-like)
 *
 * A caller MAY override with its own `ttlMs`.
 */
export const DEFAULT_TTL_BY_ROLE: Readonly<Record<string, number>> = Object.freeze({
  rd: LEASE_RD_TTL_MINUTES * MS_PER_MINUTE,
  qa: LEASE_QA_TTL_MINUTES * MS_PER_MINUTE,
  ui: LEASE_UI_TTL_MINUTES * MS_PER_MINUTE,
  sc: LEASE_SC_TTL_MINUTES * MS_PER_MINUTE,
  prd: LEASE_PRD_TTL_MINUTES * MS_PER_MINUTE,
  general: LEASE_GENERAL_TTL_MINUTES * MS_PER_MINUTE
});

export const DEFAULT_TTL_MS = DEFAULT_TTL_BY_ROLE.rd;

/** The randomness seam: `node:crypto#randomBytes` unless a caller injects one. */
export type RandomBytes = (size: number) => Buffer;

/**
 * Compose a deterministic lease path under the per-session runtime dir.
 * Pure: same inputs → same output. The layout is
 * `<sessionRuntimeDir>/worktree-leases/<leaseId>.json`.
 */
export function leaseStoreDir(sessionRuntimeDir: string): string {
  return joinPath(sessionRuntimeDir, 'worktree-leases');
}

export function leaseFilePath(sessionRuntimeDir: string, leaseId: string): string {
  return joinPath(leaseStoreDir(sessionRuntimeDir), `${leaseId}.json`);
}

/** Compose the absolute worktree path (the `git worktree add <path>` target). */
export function worktreePath(sessionRuntimeDir: string, leaseId: string): string {
  return joinPath(sessionRuntimeDir, 'worktrees', leaseId);
}

/**
 * Generate a 16-hex lease id (8 random bytes, hex-encoded). The id is unique
 * enough for the per-session scope; collisions across sessions are irrelevant
 * because each session has its own lease directory.
 */
export function generateLeaseId(options: { readonly randomBytes?: RandomBytes } = {}): string {
  const draw = options.randomBytes ?? cryptoRandomBytes;
  return draw(LEASE_ID_RANDOM_BYTES).toString('hex');
}

/**
 * Compute the TTL ms for a role, falling back to `DEFAULT_TTL_MS` for unknown
 * roles. The caller overrides with a positive `ttlMs` when it has one.
 */
export function ttlForRole(role: string): number {
  const normalized = role.toLowerCase();
  const candidate: number | undefined = DEFAULT_TTL_BY_ROLE[normalized];
  const fallback: number = DEFAULT_TTL_BY_ROLE['rd'] ?? LEASE_RD_TTL_MINUTES * MS_PER_MINUTE;
  return candidate ?? fallback;
}

/**
 * Pure: produce a fresh `WorktreeLease` from a draft.
 * `status` starts at `'active'`; `consumedBySubAgents` starts empty.
 */
export function finalizeLease(draft: WorktreeLeaseDraft): WorktreeLease {
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
export function recordConsumption(lease: WorktreeLease, subAgentId: string): WorktreeLease {
  if (lease.consumedBySubAgents.includes(subAgentId)) return lease;
  return { ...lease, consumedBySubAgents: [...lease.consumedBySubAgents, subAgentId] };
}

/**
 * Pure: is the lease still active (status === 'active' AND not past expiry).
 * Expired leases are NOT auto-released; the gc action is the only path that
 * transitions them. Until then the on-disk status stays 'active' but this
 * helper returns false so consumers skip the lease.
 */
export function isLeaseActive(lease: WorktreeLease, now: number = Date.now()): boolean {
  return lease.status === 'active' && lease.expiresAt > now;
}

/**
 * List every lease file under the session's lease store dir.
 *
 * Pure with respect to its inputs: it does NOT sort or filter, and it does NOT
 * mark anything expired. Callers apply their own sort/filter and treat an
 * over-expiry lease as an expired candidate. A malformed file is surfaced as a
 * `{ file, error }` record rather than thrown, so one bad file cannot hide the
 * rest of the store.
 */
export function listLeasesSync(
  storeDir: string,
  fs: {
    readdir: (path: string) => ReadonlyArray<string>;
    readFile: (path: string) => string;
    existsSync: (path: string) => boolean;
  }
): LeaseListResult {
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
 * Pure: a lease is eligible for gc if its status is one of {released, expired}
 * or it is still 'active' but past its expiry. A 'gc' lease is terminal.
 */
export function isLeaseGcEligible(lease: WorktreeLease, now: number = Date.now()): boolean {
  if (lease.status === 'gc') return false;
  if (lease.status === 'released') return true;
  return lease.expiresAt <= now;
}

/**
 * Pure: derive a new lease from an existing one with an extended `expiresAt`.
 * Other fields are preserved; the status returns to 'active'.
 */
export function renewLease(lease: WorktreeLease, newExpiresAt: number): WorktreeLease {
  return { ...lease, expiresAt: newExpiresAt, status: 'active' };
}

/** Pure: serialize a lease to JSON with stable field order (deterministic output). */
export function serializeLease(lease: WorktreeLease): string {
  return JSON.stringify(lease, null, 2) + '\n';
}

/**
 * Pure: deserialize a lease from JSON. Throws on malformed input — callers
 * catch and surface the reason instead of failing open on a malformed lease.
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

/** Internal: fold separators to forward slashes, then posix-join. A Windows
 *  caller passes `C:\dir`; posix.join sees the backslashes and mangles the
 *  path, so both the read and the write here go through this one function. */
function joinPath(...segments: ReadonlyArray<string>): string {
  if (segments.length === 0) return '';
  const normalized = segments.map((s) => s.replace(/\\/g, '/'));
  let acc: string = normalized[0] as string;
  for (let i = 1; i < normalized.length; i++) {
    acc = path.join(acc, normalized[i] as string);
  }
  return acc;
}
