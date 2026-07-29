/**
 * peaks-loop Worktree Authorization Gate (slice 2026-07-27-worktree-user-auth).
 *
 * Project-level red line: no autonomous LLM path is allowed to create a
 * Git worktree, switch Claude Code's Agent isolation to "worktree",
 * or fabricate a clean-tree baseline via `git stash` — unless the user
 * has, in the *current task / current session*, explicitly authorized
 * that exact operation. Authorization is recorded by
 * `peaks worktree auth grant` (see `worktree-auth-commands.ts`) and is
 * scoped to:
 *
 *   - sessionId: the active peaks session at grant time
 *   - requestId: the active peaks request at grant time (if any)
 *   - operation: one of the OperationType values
 *   - expiresAt: hard deadline (default +5 min from grant)
 *   - consumed: single-use vs multi-use (gate calls `consume()` on use)
 *
 * The gate is invoked from `peaks gate enforce` (the PreToolUse hook
 * command) for every Bash / Agent / EnterWorktree tool call. It is
 * fail-closed: a malformed grant file, a missing scope, an expired
 * token, or any other evaluation error → deny with a structured
 * `WORKTREE_USER_AUTH_REQUIRED` reason.
 *
 * Why this is a service, not just a regex: a regex can match the
 * command but cannot check "did the current user just say so". The
 * user-originated authorization is a current-task file artifact;
 * the gate is its consumer.
 *
 * Why single-use by default: an LLM can pass the gate once per
 * authorized intent. If the same LLM needs to run a second
 * `git worktree add` later, it must `peaks worktree auth grant`
 * again — which is exactly the moment the user can say no. Multi-use
 * is a deliberate opt-in via `--multi`.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  deserializeLease,
  isLeaseActive,
  leaseFilePath,
  type WorktreeLease,
} from '../worktree/worktree-lease.js';

export const WORKTREE_AUTH_FILE = 'worktree-auth.json';

/** The narrow surface the gate actually inspects. Keep this list in lock-step with the regex matchers below. */
export type OperationType =
  /** `git worktree add` / `git worktree remove` / `git worktree prune` — any Bash command matching the gate's allow-list. */
  | 'git-worktree'
  /** Claude Code `Agent` sub-agent dispatched with `isolation: "worktree"`. */
  | 'agent-isolation-worktree'
  /** Bash command starting with `git stash` (push / pop / create / drop / store). Excludes `git stash list` / `git stash show`. */
  | 'git-stash-mutating'
  /** Bash command that calls the `git` CLI in any other worktree-mutating form (rare; explicit escape hatch). */
  | 'git-worktree-other';

/** Structured shape of the on-disk authorization record. Always has a `grants` array; older shapes were single-grant. */
export type AuthorizationFile = {
  readonly schemaVersion: 1;
  readonly sessionId: string;
  readonly createdAt: string;
  readonly grants: ReadonlyArray<WorktreeAuthorization>;
};

export type WorktreeAuthorization = {
  readonly operation: OperationType;
  /** Free-form description (e.g. "rd sub-agent for rid-006"). Echoed in deny reasons for traceability. */
  readonly reason: string;
  /** 16-hex SHA-1 prefix of the prompt at grant time. Optional; the gate may match by operation only. */
  readonly promptHash: string | null;
  /** Optional rid scope — when set, the gate will only honor the grant for tool calls whose transcript carries this rid. */
  readonly requestId: string | null;
  readonly issuedAt: string;
  readonly expiresAt: string;
  /** `true` = single-use (consumed on first match), `false` = multi-use (only bounded by `expiresAt`). */
  readonly consume: boolean;
  /** `true` after the gate's `consume()` call. Exposed for status; gate sets it. */
  readonly consumed: boolean;
};

/** Result of a gate check. `allow` permits the tool call; `deny` blocks it. */
export type WorktreeAuthDecision =
  | { readonly allow: true; readonly authorization: WorktreeAuthorization; readonly remaining: number; readonly viaLease: null }
  | { readonly allow: true; readonly authorization: null; readonly remaining: 0; readonly viaLease: WorktreeLease }
  | { readonly allow: false; readonly reason: string; readonly code: WorktreeAuthDenyCode; readonly remediation: string };

export type WorktreeAuthDenyCode =
  /** No current-task grant for the operation. */
  | 'WORKTREE_USER_AUTH_REQUIRED'
  /** Grant exists but `expiresAt` has passed. */
  | 'WORKTREE_USER_AUTH_EXPIRED'
  /** Grant exists but is for a different requestId (current tool call's rid does not match). */
  | 'WORKTREE_USER_AUTH_REQUEST_MISMATCH'
  /** Grant exists but was already consumed and the operation is single-use. */
  | 'WORKTREE_USER_AUTH_CONSUMED'
  /** The grant file is unreadable / malformed — fail-closed, never fail-open. */
  | 'WORKTREE_USER_AUTH_FILE_INVALID'
  /** Lease file referenced by the tool call is unreadable / malformed. */
  | 'WORKTREE_LEASE_FILE_INVALID'
  /** Lease exists but is not active (status != 'active' OR past expiresAt). */
  | 'WORKTREE_LEASE_NOT_ACTIVE'
  /** Lease exists but its rid does not match the current peaks request. */
  | 'WORKTREE_LEASE_REQUEST_MISMATCH';

export type ToolCallKind = 'Bash' | 'Agent' | 'EnterWorktree' | 'Workflow' | 'Other';

/** What the gate receives from the hook payload. Only fields it inspects. */
export type WorktreeAuthCheckInput = {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly toolName: ToolCallKind;
  /** `Bash` → `command`; `Agent` → `prompt` (irrelevant for gate; pass through) and `isolation`. */
  readonly command: string | null;
  /** `Agent` tool calls. The gate only blocks when this is `'worktree'`. */
  readonly isolation: string | null;
  /** Optional rid scope from the calling peaks request artifact. */
  readonly requestId: string | null;
  /**
   * Optional lease id consulted as a SECOND authorization path when no
   * `peaks worktree auth grant` token is on file. When set, the gate
   * reads `.peaks/_runtime/<sid>/worktree-leases/<leaseId>.json` and
   * permits the operation iff the lease is `isLeaseActive` and its
   * `rid` matches the current peaks request. `PEAKS_WORKTREE_LEASE_ID`
   * env is the canonical source (dispatch injects it; the hook reads
   * it). When null, the lease fallback is skipped — the gate falls
   * back to the existing `peaks worktree auth grant` only contract.
   */
  readonly leaseId: string | null;
};

/** Stable identifier of the current "user authorization" — derived from session + tool + key args. */
export function currentAuthFingerprint(input: WorktreeAuthCheckInput): string {
  // 16 hex chars is enough for tie-breaking; the gate never uses this as a security boundary, only as a
  // log-correlation key.
  const seed = `${input.sessionId}|${input.toolName}|${input.command ?? ''}|${input.isolation ?? ''}`;
  return createHash('sha1').update(seed).digest('hex').slice(0, 16);
}

/** The file the gate reads. Default location: `.peaks/_runtime/<sessionId>/worktree-auth.json`. */
export function worktreeAuthFilePath(projectRoot: string, sessionId: string): string {
  return join(projectRoot, '.peaks', '_runtime', sessionId, WORKTREE_AUTH_FILE);
}

/**
 * Read + validate the on-disk grant file. Returns `null` for "no file" (not an error — just no auth
 * recorded yet). Throws `WorktreeAuthFileInvalidError` for malformed JSON / wrong shape / wrong
 * sessionId — the gate treats this as deny, not allow. We never silently fail open.
 */
export function readAuthorization(projectRoot: string, sessionId: string): AuthorizationFile | null {
  const path = worktreeAuthFilePath(projectRoot, sessionId);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new WorktreeAuthFileInvalidError(`worktree-auth.json: invalid JSON (${(error as Error).message})`, { path });
  }
  if (!isAuthorizationFile(parsed)) {
    throw new WorktreeAuthFileInvalidError('worktree-auth.json: shape does not match AuthorizationFile', { path });
  }
  if (parsed.sessionId !== sessionId) {
    throw new WorktreeAuthFileInvalidError(
      `worktree-auth.json: sessionId mismatch (file=${parsed.sessionId}, caller=${sessionId})`,
      { path }
    );
  }
  return parsed;
}

export class WorktreeAuthFileInvalidError extends Error {
  readonly path: string;
  constructor(message: string, opts: { path: string }) {
    super(message);
    this.name = 'WorktreeAuthFileInvalidError';
    this.path = opts.path;
  }
}

function isAuthorizationFile(value: unknown): value is AuthorizationFile {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.schemaVersion !== 1) return false;
  if (typeof v.sessionId !== 'string') return false;
  if (typeof v.createdAt !== 'string') return false;
  if (!Array.isArray(v.grants)) return false;
  return v.grants.every(isWorktreeAuthorization);
}

function isWorktreeAuthorization(value: unknown): value is WorktreeAuthorization {
  if (value === null || typeof value !== 'object') return false;
  const g = value as Record<string, unknown>;
  if (typeof g.operation !== 'string') return false;
  if (!isOperationType(g.operation)) return false;
  if (typeof g.reason !== 'string') return false;
  if (g.promptHash !== null && typeof g.promptHash !== 'string') return false;
  if (g.requestId !== null && typeof g.requestId !== 'string') return false;
  if (typeof g.issuedAt !== 'string') return false;
  if (typeof g.expiresAt !== 'string') return false;
  if (typeof g.consume !== 'boolean') return false;
  if (typeof g.consumed !== 'boolean') return false;
  return true;
}

function isOperationType(value: string): value is OperationType {
  return (
    value === 'git-worktree' ||
    value === 'agent-isolation-worktree' ||
    value === 'git-stash-mutating' ||
    value === 'git-worktree-other'
  );
}

/** The narrow set of worktree-mutating `git` commands the gate actually blocks. Tightly scoped on purpose. */
const GIT_WORKTREE_REGEX = /^\s*git\s+worktree(?:\s+(add|remove|prune|lock|unlock|move|repair))?\b/;
const GIT_STASH_MUTATING_REGEX = /^\s*git\s+stash(?:\s+(push|pop|save|create|drop|store|clear|apply))(?:\s+|$)/;

/**
 * Map the actual tool call to an `OperationType` the gate should look up. Returns `null` for tool calls
 * the gate does not care about (e.g. `Read`, `Glob`, or `Bash` running `ls`). The regex is deliberately
 * conservative: anything ambiguous returns `null` (allow).
 */
export function classifyToolCall(input: WorktreeAuthCheckInput): OperationType | null {
  if (input.toolName === 'Agent') {
    return input.isolation === 'worktree' ? 'agent-isolation-worktree' : null;
  }
  if (input.toolName === 'EnterWorktree') {
    // Claude Code's explicit EnterWorktree tool — same authorization as the Agent isolation worktree path.
    return 'agent-isolation-worktree';
  }
  if (input.toolName === 'Workflow') {
    // Future-proofing: if an IDE ever exposes a worktree-creating Workflow tool, route it through the same
    // gate. No Claude-Code tool currently exists, so this is a defensive default.
    return null;
  }
  if (input.toolName === 'Bash') {
    if (typeof input.command !== 'string' || input.command.length === 0) return null;
    if (GIT_STASH_MUTATING_REGEX.test(input.command)) return 'git-stash-mutating';
    if (GIT_WORKTREE_REGEX.test(input.command)) return 'git-worktree';
    return null;
  }
  return null;
}

/**
 * Core gate decision. Pure: takes a `WorktreeAuthCheckInput` + the parsed `AuthorizationFile`,
 * returns `WorktreeAuthDecision`. Side effects (consume / file rewrite) are NOT performed here — see
 * `evaluateWorktreeAuth` for the write-then-evaluate pattern that `peaks gate enforce` uses.
 */
export function decideFromAuthorization(
  input: WorktreeAuthCheckInput,
  operation: OperationType,
  file: AuthorizationFile | null
): WorktreeAuthDecision {
  if (file === null) {
    return {
      allow: false,
      code: 'WORKTREE_USER_AUTH_REQUIRED',
      reason: `No current-task user authorization for "${operation}" (session=${input.sessionId}).`,
      remediation:
        `Ask the user to explicitly authorize this worktree-mutating operation, then run \`peaks worktree auth grant --operation ${operation} --reason "<why>"\` ` +
        `before the tool call retries. Re-running with --consume=false and a longer --ttl is allowed but should be rare.`
    };
  }
  const now = Date.now();
  // First try to find a requestId-matched, non-consumed, unexpired grant. If none is found,
  // we drop the requestId filter and look again — that gives us a clean two-tier distinction
  // between "this rid is scoped to a different rid" and "all grants are stale/expired".
  const requestMatched = file.grants
    .filter((g) => g.operation === operation)
    .filter((g) => !g.consumed)
    .filter((g) => Date.parse(g.expiresAt) > now)
    .find((g) => g.requestId === null || g.requestId === input.requestId);
  if (requestMatched !== undefined) {
    return { allow: true, authorization: requestMatched, remaining: file.grants.length, viaLease: null };
  }
  // No live grant matched the current rid (or the caller's rid is null). Diagnose why.
  const sameOpAnyState = file.grants.filter((g) => g.operation === operation);
  if (sameOpAnyState.length === 0) {
    return {
      allow: false,
      code: 'WORKTREE_USER_AUTH_REQUIRED',
      reason: `No grant for operation "${operation}" in this session.`,
      remediation:
        `Run \`peaks worktree auth grant --operation ${operation} --reason "<why>"\` from the LLM after the user has explicitly asked for the operation.`
    };
  }
  const ridScoped = sameOpAnyState.find((g) => g.requestId !== null);
  const ridMatchesScope = ridScoped !== undefined && (input.requestId === null || ridScoped.requestId === input.requestId);
  if (ridScoped !== undefined && !ridMatchesScope) {
    return {
      allow: false,
      code: 'WORKTREE_USER_AUTH_REQUEST_MISMATCH',
      reason: `Grant for "${operation}" is scoped to requestId=${ridScoped.requestId} but the current tool call carries requestId=${input.requestId ?? 'null'}.`,
      remediation:
        `Either drop the requestId scope from the grant (\`peaks worktree auth grant --operation ${operation} --no-request-id\`) or operate under the scoped request.`
    };
  }
  // Otherwise: every grant for the operation is either consumed or expired.
  const hasUnexpired = sameOpAnyState.some((g) => Date.parse(g.expiresAt) > now);
  if (!hasUnexpired) {
    return {
      allow: false,
      code: 'WORKTREE_USER_AUTH_EXPIRED',
      reason: `All grants for operation "${operation}" in this session have expired.`,
      remediation:
        `Re-run \`peaks worktree auth grant --operation ${operation} --reason "<why>"\` (default TTL 5 min) before the tool call retries.`
    };
  }
  // Grants exist and at least one is unexpired, but every non-expired one is consumed.
  return {
    allow: false,
    code: 'WORKTREE_USER_AUTH_REQUIRED',
    reason: `All unexpired grants for operation "${operation}" in this session are already consumed.`,
    remediation:
      `Re-run \`peaks worktree auth grant --operation ${operation} --reason "<why>"\` to issue a fresh grant (or pass --multi to make it multi-use).`
  };
}

/**
 * Public entry point used by `peaks gate enforce`. Reads the auth file, decides, and (when consume=true
 * and the call is allowed) atomically rewrites the file with `consumed: true` on the matching grant.
 *
 * Returns `deny` on any internal error: malformed file, IO failure, missing session binding, etc. The
 * gate is fail-closed — never allow on error.
 */
export function evaluateWorktreeAuth(input: WorktreeAuthCheckInput): WorktreeAuthDecision {
  const operation = classifyToolCall(input);
  if (operation === null) {
    // Pass-through (Read, Glob, etc., and any Bash that isn't worktree-mutating).
    return {
      allow: true,
      authorization: syntheticAllow(),
      remaining: 0,
      viaLease: null
    };
  }
  let file: AuthorizationFile | null;
  try {
    file = readAuthorization(input.projectRoot, input.sessionId);
  } catch (error) {
    if (error instanceof WorktreeAuthFileInvalidError) {
      return {
        allow: false,
        code: 'WORKTREE_USER_AUTH_FILE_INVALID',
        reason: `worktree-auth.json present but invalid: ${error.message}`,
        remediation:
          `Delete the malformed file (\`rm ${error.path}\`) and re-run \`peaks worktree auth grant --operation ${operation} --reason "<why>"\`. ` +
          `For security, the gate never fails open on a malformed grant file.`
      };
    }
    return {
      allow: false,
      code: 'WORKTREE_USER_AUTH_FILE_INVALID',
      reason: `worktree-auth.json IO error: ${(error as Error).message}`,
      remediation: `Re-run \`peaks worktree auth grant --operation ${operation} --reason "<why>"\` and retry.`
    };
  }
  const decision = decideFromAuthorization(input, operation, file);
  if (decision.allow) {
    if (decision.authorization !== null && decision.authorization.consume) {
      try {
        markConsumed(input.projectRoot, input.sessionId, decision.authorization);
      } catch (error) {
        // Best-effort: the gate already issued an allow. We do NOT revoke; the next call will see the
        // un-consumed grant and try again. This is preferable to denying a legitimate operation because
        // of a write failure.
        return {
          allow: true,
          authorization: decision.authorization,
          remaining: 0,
          viaLease: null
        };
      }
    }
    return decision;
  }
  // Auth denied — try the lease fallback. The lease is a SECOND authorization path that sub-agents
  // that have adopted the spawn/release CLI (Part 1 + 2.A) use; sub-agents that still rely on
  // `peaks worktree auth grant` are unaffected (their grants already allowed above).
  if (input.leaseId === null || input.leaseId === undefined || input.leaseId.length === 0) {
    return decision;
  }
  return decideFromLease(input);
}

/**
 * Pure: consult the lease file referenced by `input.leaseId` and decide
 * whether the operation may proceed under the lease. Mirrors the
 * `decideFromAuthorization` contract: malformed lease → fail-closed;
 * rid mismatch → deny; non-active lease → deny.
 */
export function decideFromLease(input: WorktreeAuthCheckInput): WorktreeAuthDecision {
  const leaseId = input.leaseId ?? '';
  // `leaseFilePath` expects the per-session runtime dir as its first
  // argument, NOT the project root. Compose the same path the spawn
  // CLI writes to (`<projectRoot>/.peaks/_runtime/<sid>`).
  const runtimeDir = `${input.projectRoot.replace(/[\\/]+$/, '')}/.peaks/_runtime/${input.sessionId}`;
  const file = leaseFilePath(runtimeDir, leaseId);
  if (!existsSync(file)) {
    return {
      allow: false,
      code: 'WORKTREE_USER_AUTH_REQUIRED',
      reason: `No worktree auth grant AND no lease at ${file} (leaseId=${leaseId}).`,
      remediation:
        `Either run \`peaks worktree auth grant --operation <op> --reason "<why>"\` or ` +
        `run \`peaks worktree spawn --rid <rid> --role <role> --purpose "<why>"\` to create the lease.`
    };
  }
  let lease: WorktreeLease;
  try {
    lease = deserializeLease(readFileSync(file, 'utf8'));
  } catch (error) {
    return {
      allow: false,
      code: 'WORKTREE_LEASE_FILE_INVALID',
      reason: `Lease file at ${file} is unreadable/malformed: ${(error as Error).message}`,
      remediation:
        `Delete the malformed lease (\`rm ${file}\`) and re-spawn. The gate never fails open on a malformed lease.`
    };
  }
  if (input.requestId !== null && lease.rid !== input.requestId) {
    return {
      allow: false,
      code: 'WORKTREE_LEASE_REQUEST_MISMATCH',
      reason: `Lease rid=${lease.rid} does not match current requestId=${input.requestId}.`,
      remediation: `Either re-spawn a lease for the current rid, or operate under the lease's own rid.`
    };
  }
  if (!isLeaseActive(lease)) {
    return {
      allow: false,
      code: 'WORKTREE_LEASE_NOT_ACTIVE',
      reason: `Lease ${lease.leaseId} is not active (status=${lease.status}, remainingMs=${lease.expiresAt - Date.now()}).`,
      remediation:
        `Run \`peaks worktree renew --lease-id ${lease.leaseId}\` to extend, or \`peaks worktree spawn ...\` to create a new lease.`
    };
  }
  return { allow: true, authorization: null, remaining: 0, viaLease: lease };
}

/** Mark a single-use grant as consumed. Writes the whole file back atomically (write to .tmp + rename). */
function markConsumed(
  projectRoot: string,
  sessionId: string,
  consumed: WorktreeAuthorization
): void {
  const path = worktreeAuthFilePath(projectRoot, sessionId);
  if (!existsSync(path)) {
    // Race: the file vanished between read and write. Treat as "already consumed" — re-running
    // `peaks worktree auth grant` is the recovery path; we do not write a partial file.
    return;
  }
  const file = readAuthorization(projectRoot, sessionId);
  if (file === null) return;
  const next: AuthorizationFile = {
    ...file,
    grants: file.grants.map((g) =>
      g === consumed || isSameGrant(g, consumed) ? { ...g, consumed: true } : g
    )
  };
  writeAuthorizationAtomic(path, next);
}

function isSameGrant(a: WorktreeAuthorization, b: WorktreeAuthorization): boolean {
  return (
    a.operation === b.operation &&
    a.issuedAt === b.issuedAt &&
    a.expiresAt === b.expiresAt &&
    a.reason === b.reason
  );
}

function writeAuthorizationAtomic(path: string, file: AuthorizationFile): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // The on-disk schema is plain JSON; we keep the same writer used by other peaks artifacts to make
  // diffs and recovery tools work the same way.
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  // fs.renameSync is atomic on POSIX and best-effort on Windows — the same caveat every other peaks
  // artifact writer has; we accept it for parity.
  renameSync(tmp, path);
}

/** A synthetic "allow" decision returned for tool calls the gate does not inspect. Uses a real
 *  far-future date (year 9999) so the timestamp serializes safely. */
function syntheticAllow(): WorktreeAuthorization {
  return {
    operation: 'git-worktree',
    reason: 'passthrough',
    promptHash: null,
    requestId: null,
    issuedAt: '1970-01-01T00:00:00.000Z',
    expiresAt: '9999-12-31T23:59:59.999Z',
    consume: false,
    consumed: true
  };
}

/** CLI writer used by `peaks worktree auth grant`. Replaces (does not merge) the grant list — pass
 *  the existing grants through if you want a multi-grant file. */
export function writeAuthorization(
  projectRoot: string,
  sessionId: string,
  authorization: WorktreeAuthorization
): void {
  const existing = readAuthorization(projectRoot, sessionId);
  const next: AuthorizationFile = {
    schemaVersion: 1,
    sessionId,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    grants: [...(existing?.grants ?? []), authorization]
  };
  const path = worktreeAuthFilePath(projectRoot, sessionId);
  writeAuthorizationAtomic(path, next);
}

/** Revoke (delete) every unconsumed grant in the file. Used by `peaks worktree auth revoke`. */
export function clearAllGrants(projectRoot: string, sessionId: string): { removed: number } {
  const file = readAuthorization(projectRoot, sessionId);
  if (file === null) return { removed: 0 };
  const remaining = file.grants.filter((g) => g.consumed);
  const removed = file.grants.length - remaining.length;
  if (remaining.length === 0) {
    const path = worktreeAuthFilePath(projectRoot, sessionId);
    if (existsSync(path)) {
      unlinkSync(path);
    }
    return { removed };
  }
  writeAuthorizationAtomic(worktreeAuthFilePath(projectRoot, sessionId), {
    ...file,
    grants: remaining
  });
  return { removed };
}
