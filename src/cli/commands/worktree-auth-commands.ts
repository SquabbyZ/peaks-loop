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
}
