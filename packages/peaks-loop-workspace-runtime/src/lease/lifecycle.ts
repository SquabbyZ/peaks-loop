/**
 * lease/lifecycle — the spawn / renew / release / gc action bodies.
 *
 * These are the behaviours behind `peaks worktree <verb>`, with every effect
 * injected: `fs`, `runGit`, the clock value, and the random source. Nothing
 * here prints, exits, reads the environment, or resolves a directory from the
 * working directory — the caller decides all of that and passes it in.
 *
 * A caller-visible outcome (a missing lease, a malformed one, a non-renewable
 * status) is a structured result, not a throw.
 */

import { sessionRuntimeDir, type SessionScope } from '../state-root.js';
import {
  addWorktree,
  pruneWorktreesBestEffort,
  removeWorktreeBestEffort,
  type RunGit
} from '../worktree/git.js';
import {
  deserializeLease,
  finalizeLease,
  generateLeaseId,
  isLeaseGcEligible,
  leaseFilePath,
  leaseStoreDir,
  listLeasesSync,
  markExpired,
  markGc,
  markReleased,
  renewLease,
  serializeLease,
  ttlForRole,
  worktreePath,
  type RandomBytes
} from './store.js';
import type { LeaseReadError, WorktreeLease, WorktreeLeaseStatus } from './types.js';

/** The filesystem seam used by the lifecycle actions. */
export interface LeaseFs {
  readonly readFile: (file: string) => string;
  /** Write exactly these contents; create parent directories as needed. */
  readonly writeFile: (file: string, contents: string) => void;
  readonly existsSync: (file: string) => boolean;
  readonly readdir: (dir: string) => ReadonlyArray<string>;
}

/** Every effect an action can have. `now` is read once per action, as the CLI does. */
export interface LeaseEffects {
  readonly fs: LeaseFs;
  readonly runGit: RunGit;
  readonly now: number;
  readonly randomBytes?: RandomBytes;
}

/** A state root, a session beneath it, and the git directory the worktree calls run from. */
export interface LeaseScope extends SessionScope {
  readonly projectRoot: string;
}

const MAX_BRANCH_NAME_LENGTH = 80;

export interface SpawnInput extends LeaseScope {
  readonly rid: string;
  readonly role: string;
  readonly purpose: string;
  /** Absent means the role's default TTL. */
  readonly ttlMs?: number;
  /** Absent means a branch name derived from `rid`. */
  readonly branch?: string;
}

export type SpawnResult =
  | {
      readonly kind: 'ok';
      readonly lease: WorktreeLease;
      readonly leaseFile: string;
      readonly ttlMs: number;
    }
  | { readonly kind: 'failed'; readonly error: string };

/**
 * Write the lease AFTER `git worktree add` succeeds, so a failed add never
 * leaves a lease that points at a worktree which does not exist.
 */
export function runSpawn(input: SpawnInput, effects: LeaseEffects): SpawnResult {
  const runtimeDir = sessionRuntimeDir(input);
  const leaseId = generateLeaseId({ randomBytes: effects.randomBytes });
  const ttlMs = input.ttlMs ?? ttlForRole(input.role);
  const branch = input.branch ?? deriveBranch(input.rid);
  const wtPath = worktreePath(runtimeDir, leaseId);
  const leaseFile = leaseFilePath(runtimeDir, leaseId);
  const lease = finalizeLease({
    leaseId,
    rid: input.rid,
    role: input.role,
    path: wtPath,
    branch,
    createdAt: effects.now,
    expiresAt: effects.now + ttlMs,
    purpose: input.purpose
  });
  try {
    addWorktree(effects.runGit, input.projectRoot, wtPath, branch);
    effects.fs.writeFile(leaseFile, serializeLease(lease));
  } catch (error) {
    return { kind: 'failed', error: errorMessage(error) };
  }
  return { kind: 'ok', lease, leaseFile, ttlMs };
}

/** Branch names must be safe for git ref-format; the cap keeps a pathological rid usable. */
function deriveBranch(rid: string): string {
  return rid.replace(/[^A-Za-z0-9._/-]/g, '-').slice(0, MAX_BRANCH_NAME_LENGTH);
}

export type LeaseFileFailure =
  | { readonly kind: 'lease-not-found'; readonly file: string }
  | { readonly kind: 'lease-invalid'; readonly file: string; readonly error: string };

type LeaseLoad =
  | { readonly ok: true; readonly lease: WorktreeLease }
  | { readonly ok: false; readonly failure: LeaseFileFailure };

/** A missing or malformed lease file is a result, never a throw. */
function loadLease(fs: LeaseFs, file: string): LeaseLoad {
  if (!fs.existsSync(file)) return { ok: false, failure: { kind: 'lease-not-found', file } };
  try {
    return { ok: true, lease: deserializeLease(fs.readFile(file)) };
  } catch (error) {
    return { ok: false, failure: { kind: 'lease-invalid', file, error: errorMessage(error) } };
  }
}

export interface RenewInput extends LeaseScope {
  readonly leaseId: string;
  /** Absent means the role's default TTL. */
  readonly ttlMs?: number;
}

export type RenewResult =
  | LeaseFileFailure
  | { readonly kind: 'not-renewable'; readonly lease: WorktreeLease }
  | { readonly kind: 'invalid-ttl'; readonly ttlMs: number | undefined }
  | {
      readonly kind: 'ok';
      readonly lease: WorktreeLease;
      readonly previous: WorktreeLease;
      readonly ttlMs: number;
    };

export function runRenew(input: RenewInput, effects: LeaseEffects): RenewResult {
  const file = leaseFilePath(sessionRuntimeDir(input), input.leaseId);
  const loaded = loadLease(effects.fs, file);
  if (!loaded.ok) return loaded.failure;
  const lease = loaded.lease;
  if (lease.status === 'released' || lease.status === 'gc') {
    return { kind: 'not-renewable', lease };
  }
  const ttlMs = input.ttlMs ?? ttlForRole(lease.role);
  if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
    return { kind: 'invalid-ttl', ttlMs: input.ttlMs };
  }
  const renewed = renewLease(lease, effects.now + ttlMs);
  effects.fs.writeFile(file, serializeLease(renewed));
  return { kind: 'ok', lease: renewed, previous: lease, ttlMs };
}

export interface ReleaseInput extends LeaseScope {
  readonly leaseId: string;
}

export type ReleaseResult =
  | LeaseFileFailure
  | { readonly kind: 'already-released'; readonly lease: WorktreeLease }
  | {
      readonly kind: 'ok';
      readonly lease: WorktreeLease;
      readonly previous: WorktreeLease;
      readonly gitWorktreeRemoveFailed: boolean;
    };

/** Idempotent on an already-released lease: no git call, no write. */
export function runRelease(input: ReleaseInput, effects: LeaseEffects): ReleaseResult {
  const file = leaseFilePath(sessionRuntimeDir(input), input.leaseId);
  const loaded = loadLease(effects.fs, file);
  if (!loaded.ok) return loaded.failure;
  const lease = loaded.lease;
  if (lease.status === 'released') return { kind: 'already-released', lease };
  const gitWorktreeRemoveFailed = removeWorktreeBestEffort(
    effects.runGit,
    input.projectRoot,
    lease.path
  );
  const released = markReleased(lease);
  effects.fs.writeFile(file, serializeLease(released));
  return { kind: 'ok', lease: released, previous: lease, gitWorktreeRemoveFailed };
}

export interface GcInput extends LeaseScope {
  /** Only consider this specific lease. */
  readonly leaseId?: string;
  /** Report what would be swept without mutating anything. */
  readonly dryRun?: boolean;
}

export interface SweptLease {
  readonly leaseId: string;
  readonly path: string;
  readonly previousStatus: WorktreeLeaseStatus;
  readonly gitWorktreeRemoveFailed: boolean;
}

export type GcResult =
  | { readonly kind: 'store-missing'; readonly storeDir: string }
  | {
      readonly kind: 'ok';
      readonly storeDir: string;
      readonly dryRun: boolean;
      readonly candidates: number;
      readonly swept: ReadonlyArray<SweptLease>;
      readonly errors: ReadonlyArray<LeaseReadError>;
    };

type SweepContext = {
  readonly input: GcInput;
  readonly effects: LeaseEffects;
  readonly runtimeDir: string;
  readonly dryRun: boolean;
};

export function runGc(input: GcInput, effects: LeaseEffects): GcResult {
  const runtimeDir = sessionRuntimeDir(input);
  const storeDir = leaseStoreDir(runtimeDir);
  const listed = listLeasesSync(storeDir, {
    readdir: effects.fs.readdir,
    readFile: effects.fs.readFile,
    existsSync: effects.fs.existsSync
  });
  if (listed.kind === 'store-missing') return { kind: 'store-missing', storeDir };
  const dryRun = input.dryRun === true;
  const candidates = listed.leases
    .filter((lease) => input.leaseId === undefined || lease.leaseId === input.leaseId)
    .filter((lease) => isLeaseGcEligible(lease, effects.now));
  const ctx: SweepContext = { input, effects, runtimeDir, dryRun };
  const swept = candidates.map((lease) => sweepLease(lease, ctx));
  return {
    kind: 'ok',
    storeDir,
    dryRun,
    candidates: candidates.length,
    swept,
    errors: listed.errors
  };
}

/**
 * An active lease past its expiry is marked expired first, then gc. With
 * `dryRun` nothing is mutated: no git call, no prune, no write.
 */
function sweepLease(lease: WorktreeLease, ctx: SweepContext): SweptLease {
  const { input, effects, runtimeDir, dryRun } = ctx;
  const expired =
    lease.status === 'active' && lease.expiresAt <= effects.now ? markExpired(lease) : lease;
  if (dryRun) {
    return {
      leaseId: lease.leaseId,
      path: lease.path,
      previousStatus: lease.status,
      gitWorktreeRemoveFailed: false
    };
  }
  const gitWorktreeRemoveFailed = removeWorktreeBestEffort(
    effects.runGit,
    input.projectRoot,
    expired.path
  );
  pruneWorktreesBestEffort(effects.runGit, input.projectRoot);
  effects.fs.writeFile(leaseFilePath(runtimeDir, lease.leaseId), serializeLease(markGc(expired)));
  return {
    leaseId: lease.leaseId,
    path: lease.path,
    previousStatus: lease.status,
    gitWorktreeRemoveFailed
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
