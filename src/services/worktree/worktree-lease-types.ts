/**
 * worktree-lease-types — the pure declaration surface of the worktree lease
 * store (`worktree-lease.ts`).
 *
 * Slice 2026-07-29-worktree-l2-extended Part 1 owns the lease behavior; this
 * module owns only the shapes (lifecycle status, lease record, creation draft,
 * and the list-read result). `worktree-lease.ts` imports and re-exports every
 * name here, so importers keep resolving them from the original path.
 */

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
  | {
      readonly kind: 'ok';
      readonly leases: ReadonlyArray<WorktreeLease>;
      readonly errors: ReadonlyArray<LeaseReadError>;
    }
  | { readonly kind: 'store-missing'; readonly storeDir: string };
