/**
 * `peaks worktree reconcile-host` + `peaks worktree auth revoke|status`
 *
 * Extracted from `worktree-auth-commands.ts` to keep that file under the
 * raw-line cap (mechanical verbatim move; validation and presentation
 * helpers only). Every decision point — the HOST_WORKTREE_RECONCILE_FAILED
 * (exit 1 / unmanaged-entries exit 1), REVOKE_FAILED (exit 1) and the
 * status FILE_INVALID (exit 1) / empty-grants (exit 0) / grants-listed
 * (exit 0) / STATUS_FAILED (exit 1) outcomes — is preserved in the
 * original order with the same emitted text.
 */

import type { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  clearAllGrants,
  readAuthorization
} from '../../services/hooks/worktree-authorization-gate.js';
import { reconcileHostWorktrees } from '../../services/worktree/host-worktree-reconciler.js';
import { resolveProjectRoot, resolveSessionId } from './worktree-lease-commands.js';

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

export function registerWorktreeAuthReconcileCommand(auth: Command, io: ProgramIO): void {
  addJsonOption(
    auth
      .command('reconcile-host')
      .description(
        'Read-only reconciliation of host-created .claude/worktrees/agent-* against the canonical Peaks lease store.'
      )
      .option('--session <sid>', 'override session id')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
      .option('--host-root <path>', 'override host worktree root')
  ).action((options: { session?: string; project?: string; hostRoot?: string; json?: boolean }) => {
    const projectRoot = resolveProjectRoot(options);
    const sessionId = resolveSessionId(options, projectRoot);
    try {
      const result = reconcileHostWorktrees({
        projectRoot,
        sessionId,
        ...(options.hostRoot !== undefined ? { hostRoot: options.hostRoot } : {})
      });
      const warnings =
        result.unmanaged.length > 0
          ? [`${result.unmanaged.length} host worktree(s) are outside Peaks lease governance.`]
          : [];
      printResult(
        io,
        ok('worktree.reconcile-host', { ...result, sessionId, projectRoot }, warnings),
        options.json
      );
      if (result.unmanaged.length > 0) process.exitCode = 1;
    } catch (error) {
      printResult(
        io,
        fail(
          'worktree.reconcile-host',
          'HOST_WORKTREE_RECONCILE_FAILED',
          getErrorMessage(error),
          { sessionId, projectRoot },
          []
        ),
        options.json
      );
      process.exitCode = 1;
    }
  });
}

export function registerWorktreeAuthRevokeCommand(auth: Command, io: ProgramIO): void {
  addJsonOption(
    auth
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
        ok(
          'worktree.auth.revoke',
          { sessionId, projectRoot, ...result },
          [],
          [
            result.removed > 0
              ? `Cleared ${result.removed} grant(s). The PreToolUse gate now fail-closes again.`
              : 'No grants to clear. The gate is already fail-closed.'
          ]
        ),
        options.json
      );
    } catch (error) {
      printResult(
        io,
        fail('worktree.auth.revoke', 'REVOKE_FAILED', getErrorMessage(error), {}, [
          'Re-run after fixing the failure (see cause in the error message).'
        ]),
        options.json
      );
      process.exitCode = 1;
    }
  });
}

function printStatusFileInvalid(
  io: ProgramIO,
  options: StatusOptions,
  sessionId: string,
  error: unknown
): void {
  printResult(
    io,
    fail('worktree.auth.status', 'FILE_INVALID', getErrorMessage(error), { sessionId }, [
      'Delete the malformed worktree-auth.json and re-grant.',
      'For security, the gate never fails open on a malformed grant file.'
    ]),
    options.json
  );
}

function printStatusNoGrants(
  io: ProgramIO,
  options: StatusOptions,
  sessionId: string,
  projectRoot: string
): void {
  printResult(
    io,
    ok(
      'worktree.auth.status',
      { sessionId, projectRoot, grants: [], file: null },
      [],
      ['No grants on file. The PreToolUse gate will fail-close on worktree-mutating tool calls.']
    ),
    options.json
  );
}

function printStatusFailed(io: ProgramIO, options: StatusOptions, error: unknown): void {
  printResult(
    io,
    fail('worktree.auth.status', 'STATUS_FAILED', getErrorMessage(error), {}, [
      'Re-run after fixing the failure (see cause in the error message).'
    ]),
    options.json
  );
}

function runStatusAction(io: ProgramIO, options: StatusOptions): void {
  try {
    const projectRoot = resolveProjectRoot(options);
    const sessionId = resolveSessionId(options, projectRoot);
    let file;
    try {
      file = readAuthorization(projectRoot, sessionId);
    } catch (error) {
      printStatusFileInvalid(io, options, sessionId, error);
      process.exitCode = 1;
      return;
    }
    if (file === null) {
      printStatusNoGrants(io, options, sessionId, projectRoot);
      return;
    }
    const now = Date.now();
    const live = file.grants.map((g) => ({
      ...g,
      expired: Date.parse(g.expiresAt) <= now
    }));
    printResult(
      io,
      ok(
        'worktree.auth.status',
        {
          sessionId,
          projectRoot,
          file: '.peaks/_runtime/' + sessionId + '/worktree-auth.json',
          grants: live
        },
        [],
        [
          `${file.grants.length} grant(s) recorded. ${live.filter((g) => !g.expired).length} still valid.`
        ]
      ),
      options.json
    );
  } catch (error) {
    printStatusFailed(io, options, error);
    process.exitCode = 1;
  }
}

export function registerWorktreeAuthStatusCommand(auth: Command, io: ProgramIO): void {
  addJsonOption(
    auth
      .command('status')
      .description(
        "Inspect the current session's worktree-authorization file (granted operations + expiry)."
      )
      .option('--session <sid>', 'override session id (default: read .peaks/_runtime/session.json)')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: StatusOptions) => {
    runStatusAction(io, options);
  });
}
