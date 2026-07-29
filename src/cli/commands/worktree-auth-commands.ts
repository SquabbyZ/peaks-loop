/**
 * `peaks worktree auth <grant|revoke|status>` — slice 2026-07-27-worktree-user-auth.
 *
 * Records (or revokes / inspects) a current-task user authorization for
 * a worktree-mutating operation. The PreToolUse gate
 * (`src/services/hooks/worktree-authorization-gate.ts`) reads the
 * resulting file before allowing `git worktree ...`, `git stash ...`,
 * or `Agent(isolation: worktree)` tool calls.
 *
 * Sub-commands:
 *   - grant   : append a one-shot (or multi-use) authorization
 *   - revoke  : remove all unconsumed grants
 *   - status  : list current grants + fingerprint
 *
 * Default TTL: 5 min, single-use. Multi-use is opt-in via --multi.
 * Default operation: `git-worktree` (the most common ask). Specify
 * `--operation agent-isolation-worktree` or `--operation git-stash-mutating`
 * when authorizing a different shape.
 *
 * This command is invoked by the LLM after the user has explicitly
 * authorized the operation in the current task. It must NOT be invoked
 * autonomously without a user prompt that names the operation. The
 * command itself does not enforce user confirmation — that is the
 * peaks-code orchestrator's responsibility (see
 * `skills/peaks-code/SKILL.md` "Worktree authorization" red line).
 */

import { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';
import {
  clearAllGrants,
  readAuthorization,
  writeAuthorization,
  type OperationType,
  type WorktreeAuthorization,
} from '../../services/hooks/worktree-authorization-gate.js';
import { atomicWriteJson } from '../../services/ide/shared/atomic-json.js';
import {
  deserializeLease,
  finalizeLease,
  generateLeaseId,
  isLeaseActive,
  isLeaseGcEligible,
  leaseFilePath,
  leaseStoreDir,
  listLeasesSync,
  markExpired,
  markGc,
  markReleased,
  renewLease,
  ttlForRole,
  worktreePath,
  type WorktreeLease,
} from '../../services/worktree/worktree-lease.js';
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync as readFileSyncNode, statSync } from 'node:fs';

const DEFAULT_TTL_MS = 5 * 60 * 1_000;
const ALLOWED_OPERATIONS: ReadonlyArray<OperationType> = [
  'git-worktree',
  'agent-isolation-worktree',
  'git-stash-mutating',
  'git-worktree-other'
];

type GrantOptions = {
  operation: string;
  reason: string;
  ttl?: string;
  multi?: boolean;
  requestId?: string;
  noRequestId?: boolean;
  promptHash?: string;
  session?: string;
  project?: string;
  json?: boolean;
};

type RevokeOptions = {
  session?: string;
  project?: string;
  json?: boolean;
};

type StatusOptions = {
  session?: string;
  project?: string;
  json?: boolean;
};

function parseOperation(raw: string): OperationType | null {
  return ALLOWED_OPERATIONS.includes(raw as OperationType) ? (raw as OperationType) : null;
}

function resolveSessionId(options: { session?: string }, projectRoot: string): string {
  if (typeof options.session === 'string' && options.session.length > 0) return options.session;
  // Reuse the same precedence as the rest of peaks: explicit --session > PEAKS_SESSION_ID > active session.json
  return process.env.PEAKS_SESSION_ID ?? getCurrentSessionId(projectRoot) ?? 'unknown-sid';
}

function resolveProjectRoot(options: { project?: string }): string {
  return options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
}

export function registerWorktreeAuthCommand(program: Command, io: ProgramIO): void {
  const auth = program
    .command('worktree')
    .description('worktree authorization gate (slice 2026-07-27-worktree-user-auth)')
    .addHelpText(
      'after',
      'Examples:\n' +
        '  peaks worktree auth grant --operation git-worktree --reason "rd sub-agent for rid-006"\n' +
        '  peaks worktree auth grant --operation agent-isolation-worktree --reason "explore worktree dispatch demo" --multi\n' +
        '  peaks worktree auth revoke\n' +
        '  peaks worktree auth status\n\n' +
        'The grant is current-task scoped: the LLM must invoke grant after the user has explicitly ' +
        'asked for the operation. The PreToolUse gate fail-closes on missing or expired grants.'
    );

  const auth_ = auth.command('auth').description('Manage worktree authorization grants (granted by the LLM after explicit user opt-in).');

  addJsonOption(
    auth_
      .command('grant')
      .description('Append a single grant to the current session\'s worktree authorization file.')
      .requiredOption('--operation <op>', `operation type: ${ALLOWED_OPERATIONS.join(' | ')}`)
      .requiredOption('--reason <text>', 'why the user authorized this operation (logged for audit)')
      .option('--ttl <ms>', `time-to-live in ms (default ${DEFAULT_TTL_MS} = 5 min)`)
      .option('--multi', 'multi-use grant (default: single-use, consumed on first match)')
      .option('--request-id <rid>', 'scope the grant to a specific peaks request id (defense in depth)')
      .option('--no-request-id', 'explicitly mark this grant as NOT scoped to any rid (default behavior)')
      .option('--prompt-hash <hex>', '16-hex prefix of the user prompt at grant time (optional, traceability)')
      .option('--session <sid>', 'override session id (default: read .peaks/_runtime/session.json)')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: GrantOptions) => {
    try {
      const op = parseOperation(options.operation);
      if (op === null) {
        printResult(
          io,
          fail(
            'worktree.auth.grant',
            'INVALID_OPERATION',
            `--operation must be one of: ${ALLOWED_OPERATIONS.join(' | ')}`,
            { operation: options.operation },
            ['Re-run with a valid --operation value.']
          ),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      if (options.reason.trim().length === 0) {
        printResult(
          io,
          fail('worktree.auth.grant', 'EMPTY_REASON', '--reason must not be empty', { reason: options.reason }, ['Provide a non-empty --reason for the audit log.']),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      const ttlMs = options.ttl === undefined ? DEFAULT_TTL_MS : Number.parseInt(options.ttl, 10);
      if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
        printResult(
          io,
          fail('worktree.auth.grant', 'INVALID_TTL', '--ttl must be a positive integer (ms)', { ttl: options.ttl }, ['Re-run with --ttl 300000 for a 5-minute window.']),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      const projectRoot = resolveProjectRoot(options);
      const sessionId = resolveSessionId(options, projectRoot);
      const issuedAt = new Date();
      const expiresAt = new Date(issuedAt.getTime() + ttlMs);
      const consume = options.multi !== true;
      const requestId: string | null = options.noRequestId
        ? null
        : (typeof options.requestId === 'string' && options.requestId.length > 0
          ? options.requestId
          : null);
      const promptHash: string | null = typeof options.promptHash === 'string' && /^[a-f0-9]{1,16}$/.test(options.promptHash)
        ? options.promptHash
        : null;
      const authorization: WorktreeAuthorization = {
        operation: op,
        reason: options.reason,
        promptHash,
        requestId,
        issuedAt: issuedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        consume,
        consumed: false
      };
      writeAuthorization(projectRoot, sessionId, authorization);
      printResult(
        io,
        ok(
          'worktree.auth.grant',
          {
            sessionId,
            projectRoot,
            authorization,
            ttlMs,
            file: '.peaks/_runtime/' + sessionId + '/worktree-auth.json'
          },
          [],
          [
            'The PreToolUse gate now permits the operation in this session until the grant expires or is consumed.',
            'Run `peaks worktree auth status` to inspect, or `peaks worktree auth revoke` to clear.'
          ]
        ),
        options.json
      );
    } catch (error) {
      printResult(
        io,
        fail('worktree.auth.grant', 'GRANT_FAILED', getErrorMessage(error), { operation: options.operation }, ['Re-run after fixing the failure (see cause in the error message).']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    auth_
      .command('revoke')
      .description('Remove all unconsumed grants for the current session.')
      .option('--session <sid>', 'override session id (default: read .peaks/_runtime/session.json)')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: RevokeOptions) => {
    try {
      const projectRoot = resolveProjectRoot(options);
      const sessionId = resolveSessionId(options, projectRoot);
      const result = clearAllGrants(projectRoot, sessionId);
      printResult(
        io,
        ok('worktree.auth.revoke', { sessionId, projectRoot, ...result }, [], [
          result.removed > 0
            ? `Cleared ${result.removed} grant(s). The PreToolUse gate now fail-closes again.`
            : 'No grants to clear. The gate is already fail-closed.'
        ]),
        options.json
      );
    } catch (error) {
      printResult(
        io,
        fail('worktree.auth.revoke', 'REVOKE_FAILED', getErrorMessage(error), {}, ['Re-run after fixing the failure (see cause in the error message).']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    auth_
      .command('status')
      .description('Inspect the current session\'s worktree-authorization file (granted operations + expiry).')
      .option('--session <sid>', 'override session id (default: read .peaks/_runtime/session.json)')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: StatusOptions) => {
    try {
      const projectRoot = resolveProjectRoot(options);
      const sessionId = resolveSessionId(options, projectRoot);
      let file;
      try {
        file = readAuthorization(projectRoot, sessionId);
      } catch (error) {
        printResult(
          io,
          fail('worktree.auth.status', 'FILE_INVALID', getErrorMessage(error), { sessionId }, [
            'Delete the malformed worktree-auth.json and re-grant.',
            'For security, the gate never fails open on a malformed grant file.'
          ]),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      if (file === null) {
        printResult(
          io,
          ok('worktree.auth.status', { sessionId, projectRoot, grants: [], file: null }, [], ['No grants on file. The PreToolUse gate will fail-close on worktree-mutating tool calls.']),
          options.json
        );
        return;
      }
      const now = Date.now();
      const live = file.grants.map((g) => ({
        ...g,
        expired: Date.parse(g.expiresAt) <= now
      }));
      printResult(
        io,
        ok('worktree.auth.status', { sessionId, projectRoot, file: '.peaks/_runtime/' + sessionId + '/worktree-auth.json', grants: live }, [], [
          `${file.grants.length} grant(s) recorded. ${live.filter((g) => !g.expired).length} still valid.`
        ]),
        options.json
      );
    } catch (error) {
      printResult(
        io,
        fail('worktree.auth.status', 'STATUS_FAILED', getErrorMessage(error), {}, ['Re-run after fixing the failure (see cause in the error message).']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  // Slice 2026-07-29-worktree-l2-extended Part 1 — `peaks worktree spawn`
  // and `peaks worktree release`. These commands own the lease lifecycle:
  // spawn writes a lease + runs `git worktree add`; release runs `git
  // worktree remove` + transitions the lease to 'released'. The remaining
  // CLI surface (renew / list / gc / status) ships in Part 2 along with
  // the hook integration that consults the lease.
  //
  // Coexistence with `peaks worktree auth`: this slice does NOT delete
  // `peaks worktree auth grant|revoke|status` — those are the L2 hook
  // gate's existing surface and remain valid for sub-agents that have
  // NOT adopted the lease contract yet. New code uses lease; old code
  // uses grant; both live on the `peaks worktree` parent command.

  type SpawnOptions = {
    rid: string;
    role: string;
    purpose: string;
    ttl?: string;
    branch?: string;
    session?: string;
    project?: string;
    json?: boolean;
  };

  type ReleaseOptions = {
    leaseId: string;
    session?: string;
    project?: string;
    json?: boolean;
  };

  function resolveTtlMs(raw: string | undefined, role: string): number {
    if (typeof raw !== 'string' || raw.length === 0) return ttlForRole(role);
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return ttlForRole(role);
    return parsed;
  }

  function deriveBranch(rid: string): string {
    // Branch names must be safe for git ref-format. Strip leading
    // `rid-` if present and replace any non-safe chars with `-`.
    return rid.replace(/[^A-Za-z0-9._/-]/g, '-').slice(0, 80);
  }

  addJsonOption(
    auth
      .command('spawn')
      .description(
        `Spawn a worktree under .peaks/_runtime/<sid>/worktrees/<leaseId>/ with a managed lease. ` +
          `The lease is the source of truth for the L2 hook gate (Part 2 of this slice); ` +
          `until the hook integration ships, sub-agents may still invoke raw \`git worktree add\` ` +
          `with a current \`peaks worktree auth grant\` token. Default TTL is role-aware ` +
          `(rd=30m / qa=15m / ui=1h); pass --ttl <ms> to override.`
      )
      .requiredOption('--rid <rid>', 'peaks request id the lease is associated with')
      .requiredOption('--role <role>', 'sub-agent role (rd | qa | ui | sc | prd | general-purpose)')
      .requiredOption('--purpose <text>', 'why this worktree was spawned (audit log)')
      .option('--ttl <ms>', `time-to-live in ms (default role-aware; override with positive number)`)
      .option('--branch <name>', 'git branch name (default: derived from rid)')
      .option('--session <sid>', 'override session id')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: SpawnOptions) => {
    const projectRoot = resolveProjectRoot(options);
    const sessionId = resolveSessionId(options, projectRoot);
    try {
      const leaseId = generateLeaseId();
      const now = Date.now();
      const ttlMs = resolveTtlMs(options.ttl, options.role);
      const branch = options.branch ?? deriveBranch(options.rid);
      const wtPath = worktreePath(joinPathSession(projectRoot, sessionId), leaseId);
      const lease = finalizeLease({
        leaseId,
        rid: options.rid,
        role: options.role,
        path: wtPath,
        branch,
        createdAt: now,
        expiresAt: now + ttlMs,
        purpose: options.purpose
      });

      // Run `git worktree add` from the project root. The PreToolUse hook
      // (Part 2 of this slice) will consult the lease file we just wrote
      // and authorize this very `git worktree add`; for Part 1 we still
      // require a current `peaks worktree auth grant` token to remain
      // consistent with the slice-027 hard gate contract.
      execSync(
        `git worktree add "${wtPath}" -b "${branch}"`,
        { cwd: projectRoot, stdio: 'pipe', encoding: 'utf8' }
      );

      atomicWriteJson(leaseFilePath(joinPathSession(projectRoot, sessionId), leaseId), lease);

      printResult(
        io,
        ok(
          'worktree.spawn',
          {
            lease,
            sessionId,
            projectRoot,
            ttlMs,
            nextActions: [
              `Worktree path: ${wtPath}`,
              `Branch: ${branch}`,
              `Lease expires at: ${new Date(lease.expiresAt).toISOString()}`,
              'Run `peaks worktree release --lease-id <leaseId>` when done',
              'Hook integration (lease-aware gate) ships in Part 2'
            ]
          },
          [],
          []
        ),
        options.json
      );
    } catch (error: unknown) {
      printResult(
        io,
        fail('worktree.spawn', 'SPAWN_FAILED', getErrorMessage(error), { rid: options.rid, role: options.role, sessionId }, [
          'Verify `git worktree add` succeeded (output above).',
          'If the lease file was NOT written, retry; the lease directory is .peaks/_runtime/<sid>/worktree-leases/.',
          'For an existing branch, pass --branch <name> explicitly (the spawn refuses to overwrite an active branch).'
        ]),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    auth
      .command('release')
      .description('Transition a lease to released and run `git worktree remove`. Idempotent on already-released leases.')
      .requiredOption('--lease-id <id>', 'lease id returned by `peaks worktree spawn`')
      .option('--session <sid>', 'override session id')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: ReleaseOptions) => {
    const projectRoot = resolveProjectRoot(options);
    const sessionId = resolveSessionId(options, projectRoot);
    try {
      const file = leaseFilePath(joinPathSession(projectRoot, sessionId), options.leaseId);
      let lease: WorktreeLease;
      try {
        if (!existsSync(file)) {
          printResult(
            io,
            fail('worktree.release', 'LEASE_NOT_FOUND', `no lease on disk at ${file}`, { leaseId: options.leaseId, file }, [
              'Run `peaks worktree list` to inspect active leases.',
              'For a never-spawned lease, this is a no-op — no further action needed.'
            ]),
            options.json
          );
          process.exitCode = 1;
          return;
        }
        const raw = readFileSyncNode(file, 'utf8');
        lease = deserializeLease(raw);
      } catch (error) {
        printResult(
          io,
          fail('worktree.release', 'LEASE_FILE_INVALID', getErrorMessage(error), { leaseId: options.leaseId, file }, [
            'Delete the malformed lease file manually and re-issue spawn.',
            'For security, release never fails open on a malformed lease.'
          ]),
          options.json
        );
        process.exitCode = 1;
        return;
      }

      if (lease.status === 'released') {
        // Idempotent: already released, nothing to do.
        printResult(
          io,
          ok('worktree.release', { lease, sessionId, projectRoot, alreadyReleased: true }, [], [`Lease ${lease.leaseId} already released; nothing to do.`]),
          options.json
        );
        return;
      }

      // Run `git worktree remove` from the project root. If the path is
      // missing on disk (e.g. manually pruned), this fails; we still
      // update the lease state so the L2 hook (Part 2) treats it as
      // released.
      let gitWorktreeRemoveFailed = false;
      try {
        execSync(`git worktree remove --force "${lease.path}"`, { cwd: projectRoot, stdio: 'pipe', encoding: 'utf8' });
      } catch {
        gitWorktreeRemoveFailed = true;
      }

      const released = markReleased(lease);
      atomicWriteJson(file, released);

      printResult(
        io,
        ok(
          'worktree.release',
          { lease: released, sessionId, projectRoot, gitWorktreeRemoveFailed },
          gitWorktreeRemoveFailed ? ['git worktree remove failed (likely the path was already pruned); lease marked released.'] : [],
          [
            `Lease ${lease.leaseId} marked released.`,
            gitWorktreeRemoveFailed
              ? 'Manual `git worktree prune` may be needed.'
              : `Worktree ${lease.path} removed.`
          ]
        ),
        options.json
      );
    } catch (error: unknown) {
      printResult(
        io,
        fail('worktree.release', 'RELEASE_FAILED', getErrorMessage(error), { leaseId: options.leaseId, sessionId }, [
          'Verify the lease id and re-run.',
          'If the lease was never spawned, no-op.'
        ]),
        options.json
      );
      process.exitCode = 1;
    }
  });

  // ─── Part 2.A: renew / list / gc / status ────────────────────────────────
  // These four commands own the rest of the lease lifecycle. The hook
  // integration (Part 2.B) and dispatch --isolation (Part 2.C) consult
  // the same on-disk lease files these commands read/write, so the
  // source-of-truth contract is preserved end-to-end.
  //
  //   renew   — extend an active lease's expiresAt
  //   list    — enumerate every lease in the session store (with filter)
  //   gc      — prune released/expired worktrees + mark leases 'gc'
  //   status  — read a single lease in detail

  type RenewOptions = {
    leaseId: string;
    ttl?: string;
    session?: string;
    project?: string;
    json?: boolean;
  };

  type ListOptions = {
    /** Filter to only leases in this lifecycle state. */
    status?: 'active' | 'released' | 'expired' | 'gc';
    /** Show only leases whose expiresAt is in the past (after applying status filter). */
    expiredOnly?: boolean;
    session?: string;
    project?: string;
    json?: boolean;
  };

  type GcOptions = {
    /** Only gc one specific lease id (default: sweep all eligible). */
    leaseId?: string;
    /** Dry-run: report what would be gc'd without mutating. */
    dryRun?: boolean;
    session?: string;
    project?: string;
    json?: boolean;
  };

  type LeaseStatusOptions = {
    leaseId: string;
    session?: string;
    project?: string;
    json?: boolean;
  };

  addJsonOption(
    auth
      .command('renew')
      .description(
        'Extend an active lease\'s `expiresAt` and persist it. Idempotent for already-active leases. ' +
          'Default TTL uses `DEFAULT_TTL_BY_ROLE[<lease.role>]`; pass --ttl <ms> to override.'
      )
      .requiredOption('--lease-id <id>', 'lease id returned by `peaks worktree spawn`')
      .option('--ttl <ms>', 'time-to-live in ms from now (default: role-default)')
      .option('--session <sid>', 'override session id')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: RenewOptions) => {
    const projectRoot = resolveProjectRoot(options);
    const sessionId = resolveSessionId(options, projectRoot);
    try {
      const file = leaseFilePath(joinPathSession(projectRoot, sessionId), options.leaseId);
      if (!existsSync(file)) {
        printResult(
          io,
          fail('worktree.renew', 'LEASE_NOT_FOUND', `no lease on disk at ${file}`, { leaseId: options.leaseId, file }, [
            'Run `peaks worktree list` to inspect active leases.',
            'For a never-spawned lease, this is a no-op.'
          ]),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      let lease: WorktreeLease;
      try {
        lease = deserializeLease(readFileSyncNode(file, 'utf8'));
      } catch (err) {
        printResult(
          io,
          fail('worktree.renew', 'LEASE_FILE_INVALID', getErrorMessage(err), { leaseId: options.leaseId, file }, [
            'Delete the malformed lease file manually and re-spawn.',
            'For security, renew never fails open on a malformed lease.'
          ]),
          options.json
        );
        process.exitCode = 1;
        return;
      }

      if (lease.status === 'released' || lease.status === 'gc') {
        printResult(
          io,
          fail(
            'worktree.renew',
            'LEASE_NOT_RENEWABLE',
            `lease is in status '${lease.status}'; only active/expired leases may be renewed`,
            { leaseId: lease.leaseId, status: lease.status },
            [
              'Released leases cannot be renewed. Run `peaks worktree spawn` to start a new lease.',
              'Gc-marked leases are terminal — re-spawn.'
            ]
          ),
          options.json
        );
        process.exitCode = 1;
        return;
      }

      const now = Date.now();
      const ttlMs = options.ttl === undefined ? ttlForRole(lease.role) : Number.parseInt(options.ttl, 10);
      if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
        printResult(
          io,
          fail('worktree.renew', 'INVALID_TTL', '--ttl must be a positive integer (ms)', { ttl: options.ttl }, [
            'Re-run with --ttl 1800000 (30 min) or omit to use role default.'
          ]),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      const renewed = renewLease(lease, now + ttlMs);
      atomicWriteJson(file, renewed);
      printResult(
        io,
        ok(
          'worktree.renew',
          { lease: renewed, sessionId, projectRoot, ttlMs, previousExpiresAt: lease.expiresAt },
          [],
          [
            `Lease ${renewed.leaseId} renewed; new expiresAt: ${new Date(renewed.expiresAt).toISOString()}.`,
            `Branch ${renewed.branch} at ${renewed.path} remains intact (no ` +
              '`git worktree` operation was performed — the worktree was always there).'
          ]
        ),
        options.json
      );
    } catch (err) {
      printResult(
        io,
        fail('worktree.renew', 'RENEW_FAILED', getErrorMessage(err), { leaseId: options.leaseId, sessionId }, [
          'Re-run after fixing the failure (see cause in the error message).'
        ]),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    auth
      .command('list')
      .description(
        'List every lease under the current session\'s lease store. ' +
          'Optionally filter by --status (active|released|expired|gc) and/or --expired-only. ' +
          'Leases past their expiresAt with status=active are still listed under "active" by default ' +
          '(`isLeaseActive` returns false for them, but the on-disk status only flips to "expired" ' +
          'after `peaks worktree gc` runs).'
      )
      .option('--status <state>', 'filter by lease status: active | released | expired | gc')
      .option('--expired-only', 'only show leases whose expiresAt is in the past')
      .option('--session <sid>', 'override session id')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: ListOptions) => {
    const projectRoot = resolveProjectRoot(options);
    const sessionId = resolveSessionId(options, projectRoot);
    try {
      const storeDir = leaseStoreDir(joinPathSession(projectRoot, sessionId));
      const result = listLeasesSync(storeDir, {
        readdir: (p) => readdirSync(p),
        readFile: (p) => readFileSyncNode(p, 'utf8'),
        existsSync: (p) => existsSync(p)
      });
      if (result.kind === 'store-missing') {
        printResult(
          io,
          ok('worktree.list', { sessionId, projectRoot, leases: [], errors: [], storeMissing: true }, [], [
            `No lease store at ${storeDir}. Spawn a worktree first (\`peaks worktree spawn ...\`).`
          ]),
          options.json
        );
        return;
      }
      const now = Date.now();
      const annotated = result.leases.map((l) => ({
        ...l,
        live: isLeaseActive(l, now),
        elapsedMs: now - l.createdAt,
        remainingMs: l.expiresAt - now
      }));
      let filtered = annotated;
      if (options.status) {
        filtered = filtered.filter((l) => l.status === options.status);
      }
      if (options.expiredOnly === true) {
        filtered = filtered.filter((l) => !l.live);
      }
      // Sort by createdAt desc — most-recent first. Stable for diffs.
      filtered = [...filtered].sort((a, b) => b.createdAt - a.createdAt);
      printResult(
        io,
        ok(
          'worktree.list',
          {
            sessionId,
            projectRoot,
            storeDir,
            totalOnDisk: result.leases.length,
            returned: filtered.length,
            errors: result.errors,
            leases: filtered
          },
          result.errors.map((e) => `Malformed lease: ${e.file} (${e.error})`),
          [
            `${filtered.length} lease(s) matched (${result.leases.length} on disk).`,
            result.errors.length > 0 ? 'Some lease files were malformed — see errors[]; they were skipped.' : ''
          ].filter(Boolean)
        ),
        options.json
      );
    } catch (err) {
      printResult(
        io,
        fail('worktree.list', 'LIST_FAILED', getErrorMessage(err), { sessionId }, [
          'Re-run after fixing the failure (see cause in the error message).'
        ]),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    auth
      .command('gc')
      .description(
        'Sweep released/expired leases: remove their git worktree (if still attached), prune git\'s ' +
          'worktree references, and mark the lease as "gc". With --lease-id <id>, only that lease is ' +
          'considered. With --dry-run, report what would be gc\'d without mutating. Expired-active ' +
          'leases (status=active but past expiresAt) are eligible — they are first marked "expired" ' +
          'then their worktree is removed.'
      )
      .option('--lease-id <id>', 'only consider this specific lease')
      .option('--dry-run', 'report what would be gc\'d without mutating')
      .option('--session <sid>', 'override session id')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: GcOptions) => {
    const projectRoot = resolveProjectRoot(options);
    const sessionId = resolveSessionId(options, projectRoot);
    try {
      const storeDir = leaseStoreDir(joinPathSession(projectRoot, sessionId));
      const result = listLeasesSync(storeDir, {
        readdir: (p) => readdirSync(p),
        readFile: (p) => readFileSyncNode(p, 'utf8'),
        existsSync: (p) => existsSync(p)
      });
      if (result.kind === 'store-missing') {
        printResult(
          io,
          ok('worktree.gc', { sessionId, projectRoot, swept: 0, storeMissing: true }, [], [
            `No lease store at ${storeDir}; nothing to gc.`
          ]),
          options.json
        );
        return;
      }
      const now = Date.now();
      const candidates = result.leases
        .filter((l) => (options.leaseId ? l.leaseId === options.leaseId : true))
        .filter((l) => isLeaseGcEligible(l, now));

      const dryRun = options.dryRun === true;
      const swept: Array<{ leaseId: string; path: string; prevStatus: WorktreeLease['status']; gitWorktreeRemoveFailed: boolean }> = [];
      for (const lease of candidates) {
        let prevStatus: WorktreeLease['status'] = lease.status;
        let updated: WorktreeLease = lease;
        // If the lease is still marked active but past expiresAt, transition to expired first.
        if (lease.status === 'active' && lease.expiresAt <= now) {
          updated = markExpired(lease);
          prevStatus = 'active';
        }
        if (!dryRun) {
          // `git worktree remove --force` is best-effort — if the path is
          // already gone we still mark the lease gc.
          let gitWorktreeRemoveFailed = false;
          try {
            execSync(`git worktree remove --force "${updated.path}"`, { cwd: projectRoot, stdio: 'pipe', encoding: 'utf8' });
          } catch {
            gitWorktreeRemoveFailed = true;
          }
          // `git worktree prune` clears any stale admin entries. Best-effort.
          try {
            execSync('git worktree prune', { cwd: projectRoot, stdio: 'pipe', encoding: 'utf8' });
          } catch {
            // ignore — prune is idempotent
          }
          const finalLease = markGc(updated);
          atomicWriteJson(leaseFilePath(joinPathSession(projectRoot, sessionId), lease.leaseId), finalLease);
          swept.push({ leaseId: lease.leaseId, path: lease.path, prevStatus, gitWorktreeRemoveFailed });
        } else {
          swept.push({ leaseId: lease.leaseId, path: lease.path, prevStatus, gitWorktreeRemoveFailed: false });
        }
      }

      printResult(
        io,
        ok(
          'worktree.gc',
          { sessionId, projectRoot, dryRun, candidates: candidates.length, swept, errors: result.errors },
          result.errors.map((e) => `Malformed lease: ${e.file} (${e.error})`),
          [
            dryRun
              ? `[dry-run] Would gc ${swept.length} lease(s); no filesystem changes were made.`
              : `Gc'd ${swept.length} lease(s).`,
            'For per-lease detail, run `peaks worktree status --lease-id <id>`.'
          ]
        ),
        options.json
      );
    } catch (err) {
      printResult(
        io,
        fail('worktree.gc', 'GC_FAILED', getErrorMessage(err), { sessionId }, [
          'Re-run after fixing the failure (see cause in the error message).'
        ]),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    auth
      .command('lease-status')
      .description(
        'Show one lease in detail: full lease record + computed `live` flag (active AND not past ' +
          'expiry) + path/branch/path-exists-on-disk diagnostics. Use this when triaging why a ' +
          'sub-agent cannot write to a worktree.'
      )
      .requiredOption('--lease-id <id>', 'lease id to inspect')
      .option('--session <sid>', 'override session id')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: LeaseStatusOptions) => {
    const projectRoot = resolveProjectRoot(options);
    const sessionId = resolveSessionId(options, projectRoot);
    try {
      const file = leaseFilePath(joinPathSession(projectRoot, sessionId), options.leaseId);
      if (!existsSync(file)) {
        printResult(
          io,
          fail('worktree.lease-status', 'LEASE_NOT_FOUND', `no lease on disk at ${file}`, { leaseId: options.leaseId, file }, [
            'Run `peaks worktree list` to inspect available leases.'
          ]),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      let lease: WorktreeLease;
      try {
        lease = deserializeLease(readFileSyncNode(file, 'utf8'));
      } catch (err) {
        printResult(
          io,
          fail('worktree.lease-status', 'LEASE_FILE_INVALID', getErrorMessage(err), { leaseId: options.leaseId, file }, [
            'Delete the malformed lease file manually and re-spawn.'
          ]),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      const now = Date.now();
      const pathExists = existsSync(lease.path);
      let pathIsDirectory = false;
      if (pathExists) {
        try {
          pathIsDirectory = statSync(lease.path).isDirectory();
        } catch {
          pathIsDirectory = false;
        }
      }
      printResult(
        io,
        ok(
          'worktree.lease-status',
          {
            sessionId,
            projectRoot,
            file: '.peaks/_runtime/' + sessionId + '/worktree-leases/' + lease.leaseId + '.json',
            lease,
            live: isLeaseActive(lease, now),
            diagnostics: {
              now,
              remainingMs: lease.expiresAt - now,
              pathExists,
              pathIsDirectory
            }
          },
          [],
          [
            `Lease ${lease.leaseId} is ${isLeaseActive(lease, now) ? 'LIVE' : 'NOT LIVE'} ` +
              `(status=${lease.status}, remaining=${lease.expiresAt - now}ms).`,
            `Worktree path ${lease.path} ${pathExists ? (pathIsDirectory ? 'exists (dir)' : 'exists (NOT a dir)') : 'MISSING'}.`
          ]
        ),
        options.json
      );
    } catch (err) {
      printResult(
        io,
        fail('worktree.lease-status', 'STATUS_FAILED', getErrorMessage(err), { leaseId: options.leaseId, sessionId }, [
          'Re-run after fixing the failure (see cause in the error message).'
        ]),
        options.json
      );
      process.exitCode = 1;
    }
  });
}

/**
 * Resolve the per-session runtime directory: `<projectRoot>/.peaks/_runtime/<sessionId>`.
 * The runtime tree is gitignored; the spawn CLI writes the lease file
 * under `<this>/worktree-leases/<leaseId>.json` and the worktree itself
 * under `<this>/worktrees/<leaseId>/`.
 */
function joinPathSession(projectRoot: string, sessionId: string): string {
  return `${projectRoot.replace(/[\\/]+$/, '')}/.peaks/_runtime/${sessionId}`;
}
