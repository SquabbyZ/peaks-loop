// Split out of `workspace/init-command.ts`: the
// typed failure arms of `peaks workspace init`. Each arm is a printer +
// exit-code pair; the dispatcher preserves the original branch order.
import {
  InvalidSessionIdError,
  ConflictingSessionError,
  LegacyChangeIdSiblingError
} from '../../../services/workspace/workspace-service.js';
import { UnsafeProjectRootError } from '../../../services/config/config-safety.js';
import { fail } from 'peaks-loop-shared/result';

import { getErrorMessage, printResult, type ProgramIO } from '../../cli-helpers.js';
import type { WorkspaceInitOptions } from './init-options.js';

/**
 * A typed refusal, not a crash: "you are standing in your home directory, which
 * is not a project" is a thing the caller can fix in one step, and the envelope
 * has to say which directory was refused and what to pass instead.
 * `WORKSPACE_INIT_FAILED` below would have buried it as an unexplained failure.
 */
function reportUnsafeProjectRoot(
  io: ProgramIO,
  error: UnsafeProjectRootError,
  options: WorkspaceInitOptions
): void {
  printResult(
    io,
    fail(
      'workspace.init',
      'UNSAFE_PROJECT_ROOT',
      error.message,
      {
        resolvedProjectRoot: error.projectRoot,
        projectOption: options.project ?? null
      },
      [
        'Pass --project <path-to-your-project> instead of a path that resolves to your home directory.',
        'This command creates .peaks/, .gitignore, .claude/settings.local.json and a codegraph index; none of those belong in $HOME.',
        'If you meant to initialize the current directory, cd into a project directory first — peaks will not write into the home directory itself.'
      ]
    ),
    options.json
  );
  process.exitCode = 1;
}

function reportInvalidSessionId(
  io: ProgramIO,
  error: InvalidSessionIdError,
  options: WorkspaceInitOptions
): void {
  printResult(
    io,
    fail('workspace.init', error.code, error.message, { sessionId: options.sessionId }, [
      'Use a date-prefixed kebab slug like 2026-05-25-add-user-auth'
    ]),
    options.json
  );
  process.exitCode = 1;
}

function reportConflictingSession(
  io: ProgramIO,
  error: ConflictingSessionError,
  options: WorkspaceInitOptions
): void {
  printResult(
    io,
    fail(
      'workspace.init',
      error.code,
      error.message,
      {
        existingSessionId: error.existingSessionId,
        requestedSessionId: error.requestedSessionId
      },
      [
        `Finish or abandon session "${error.existingSessionId}" first, then re-run workspace init.`,
        'Or pass --allow-session-rebind to override the binding (overwrites the prior binding).'
      ]
    ),
    options.json
  );
  process.exitCode = 1;
}

/**
 * Slice 2.8.3: a 2.8.0-era orphan `.peaks/_runtime/<change-id>/` was found at
 * top level. The CLI surfaces the migration steps verbatim from the error
 * message plus three concrete nextActions so the user (or LLM driver) has an
 * unambiguous recovery path. We do NOT auto-migrate because the legacy sibling
 * dir may contain user-authored content.
 */
function reportLegacyChangeIdSibling(
  io: ProgramIO,
  error: LegacyChangeIdSiblingError,
  options: WorkspaceInitOptions
): void {
  printResult(
    io,
    fail(
      'workspace.init',
      error.code,
      error.message,
      {
        sessionId: error.sessionId,
        legacyPath: error.legacyPath
      },
      [
        `Inspect ${error.legacyPath} for any user-authored content you want to keep.`,
        `Move any desired files into .peaks/_runtime/<sessionId>/<role>/ (gitignored), then delete ${error.legacyPath}.`,
        `Re-run \`peaks workspace init --project <path>\` to bind a fresh session.`
      ]
    ),
    options.json
  );
  process.exitCode = 1;
}

function reportGenericInitFailure(
  io: ProgramIO,
  error: unknown,
  options: WorkspaceInitOptions
): void {
  // The `LegacyChangeIdBindingError` catch branch is gone — the change-id
  // binding file at `.peaks/_runtime/current-change` is no longer written by
  // init, so there is no legacy binding to detect.
  printResult(
    io,
    fail(
      'workspace.init',
      'WORKSPACE_INIT_FAILED',
      getErrorMessage(error),
      { projectRoot: options.project, sessionId: options.sessionId },
      ['Verify the project path exists and is writable']
    ),
    options.json
  );
  process.exitCode = 1;
}

export function reportWorkspaceInitFailure(
  io: ProgramIO,
  error: unknown,
  options: WorkspaceInitOptions
): void {
  if (error instanceof UnsafeProjectRootError) {
    reportUnsafeProjectRoot(io, error, options);
    return;
  }
  if (error instanceof InvalidSessionIdError) {
    reportInvalidSessionId(io, error, options);
    return;
  }
  if (error instanceof ConflictingSessionError) {
    reportConflictingSession(io, error, options);
    return;
  }
  if (error instanceof LegacyChangeIdSiblingError) {
    reportLegacyChangeIdSibling(io, error, options);
    return;
  }
  reportGenericInitFailure(io, error, options);
}
