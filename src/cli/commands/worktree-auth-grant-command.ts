/**
 * `peaks worktree auth grant` — slice 2026-07-27-worktree-user-auth.
 *
 * Extracted from `worktree-auth-commands.ts` to keep that file under the
 * raw-line cap (mechanical verbatim move). The default TTL constant stays
 * in the parent module and is passed in as `defaultTtlMs`; the two
 * `no-magic-numbers` findings on it stay with it (a new sibling must be
 * clean outright). Every decision point — the INVALID_OPERATION /
 * EMPTY_REASON / INVALID_TTL / GRANT_FAILED exits and their exit codes —
 * is preserved in the original order.
 */

import type { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  writeAuthorization,
  type OperationType,
  type WorktreeAuthorization
} from '../../services/hooks/worktree-authorization-gate.js';
import { resolveProjectRoot, resolveSessionId } from './worktree-lease-commands.js';

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

function parseOperation(raw: string): OperationType | null {
  return ALLOWED_OPERATIONS.includes(raw as OperationType) ? (raw as OperationType) : null;
}

function printGrantInvalidOperation(io: ProgramIO, options: GrantOptions): void {
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
}

function printGrantEmptyReason(io: ProgramIO, options: GrantOptions): void {
  printResult(
    io,
    fail(
      'worktree.auth.grant',
      'EMPTY_REASON',
      '--reason must not be empty',
      { reason: options.reason },
      ['Provide a non-empty --reason for the audit log.']
    ),
    options.json
  );
}

function printGrantInvalidTtl(io: ProgramIO, options: GrantOptions): void {
  printResult(
    io,
    fail(
      'worktree.auth.grant',
      'INVALID_TTL',
      '--ttl must be a positive integer (ms)',
      { ttl: options.ttl },
      ['Re-run with --ttl 300000 for a 5-minute window.']
    ),
    options.json
  );
}

function buildGrantAuthorization(
  options: GrantOptions,
  op: OperationType,
  ttlMs: number
): WorktreeAuthorization {
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + ttlMs);
  const consume = options.multi !== true;
  const requestId: string | null = options.noRequestId
    ? null
    : typeof options.requestId === 'string' && options.requestId.length > 0
      ? options.requestId
      : null;
  const promptHash: string | null =
    typeof options.promptHash === 'string' && /^[a-f0-9]{1,16}$/.test(options.promptHash)
      ? options.promptHash
      : null;
  return {
    operation: op,
    reason: options.reason,
    promptHash,
    requestId,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    consume,
    consumed: false
  };
}

function printGrantAccepted(
  io: ProgramIO,
  options: GrantOptions,
  grant: {
    sessionId: string;
    projectRoot: string;
    authorization: WorktreeAuthorization;
    ttlMs: number;
  }
): void {
  const { sessionId, projectRoot, authorization, ttlMs } = grant;
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
}

function printGrantFailed(io: ProgramIO, options: GrantOptions, error: unknown): void {
  printResult(
    io,
    fail(
      'worktree.auth.grant',
      'GRANT_FAILED',
      getErrorMessage(error),
      { operation: options.operation },
      ['Re-run after fixing the failure (see cause in the error message).']
    ),
    options.json
  );
}

function runGrantAction(io: ProgramIO, defaultTtlMs: number, options: GrantOptions): void {
  try {
    const op = parseOperation(options.operation);
    if (op === null) {
      printGrantInvalidOperation(io, options);
      process.exitCode = 1;
      return;
    }
    if (options.reason.trim().length === 0) {
      printGrantEmptyReason(io, options);
      process.exitCode = 1;
      return;
    }
    const ttlMs = options.ttl === undefined ? defaultTtlMs : Number.parseInt(options.ttl, 10);
    if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
      printGrantInvalidTtl(io, options);
      process.exitCode = 1;
      return;
    }
    const projectRoot = resolveProjectRoot(options);
    const sessionId = resolveSessionId(options, projectRoot);
    const authorization = buildGrantAuthorization(options, op, ttlMs);
    writeAuthorization(projectRoot, sessionId, authorization);
    printGrantAccepted(io, options, { sessionId, projectRoot, authorization, ttlMs });
  } catch (error) {
    printGrantFailed(io, options, error);
    process.exitCode = 1;
  }
}

export function registerWorktreeAuthGrantCommand(
  auth: Command,
  io: ProgramIO,
  defaultTtlMs: number
): void {
  addJsonOption(
    auth
      .command('grant')
      .description("Append a single grant to the current session's worktree authorization file.")
      .requiredOption('--operation <op>', `operation type: ${ALLOWED_OPERATIONS.join(' | ')}`)
      .requiredOption(
        '--reason <text>',
        'why the user authorized this operation (logged for audit)'
      )
      .option('--ttl <ms>', `time-to-live in ms (default ${defaultTtlMs} = 5 min)`)
      .option('--multi', 'multi-use grant (default: single-use, consumed on first match)')
      .option(
        '--request-id <rid>',
        'scope the grant to a specific peaks request id (defense in depth)'
      )
      .option(
        '--no-request-id',
        'explicitly mark this grant as NOT scoped to any rid (default behavior)'
      )
      .option(
        '--prompt-hash <hex>',
        '16-hex prefix of the user prompt at grant time (optional, traceability)'
      )
      .option('--session <sid>', 'override session id (default: read .peaks/_runtime/session.json)')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: GrantOptions) => {
    runGrantAction(io, defaultTtlMs, options);
  });
}
