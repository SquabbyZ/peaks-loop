import type { Command } from 'commander';
import {
  listSessionMetas,
  rotateSessionBinding,
  setSessionTitle
} from '../../../services/session/session-manager.js';
import { resolveCanonicalProjectRoot } from '../../../services/config/config-service.js';
import { findProjectRoot } from '../../../services/config/config-safety.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../../cli-helpers.js';

export function registerSessionListCommand(session: Command, io: ProgramIO): void {
  addJsonOption(
    session.command('list').description('List all session directories with titles and metadata')
  ).action((options: { json?: boolean }) => {
    const projectRoot = findProjectRoot(process.cwd()) ?? process.cwd();
    const metas = listSessionMetas(projectRoot);
    printResult(io, ok('session.list', { sessions: metas, total: metas.length }), options.json);
  });
}

export function registerSessionTitleCommand(session: Command, io: ProgramIO): void {
  addJsonOption(
    session
      .command('title <sessionId> <title>')
      .description('Set a human-readable title for a session directory')
  ).action((sessionId: string, title: string, options: { json?: boolean }) => {
    const projectRoot = findProjectRoot(process.cwd()) ?? process.cwd();
    try {
      const meta = setSessionTitle(projectRoot, sessionId, title);
      printResult(io, ok('session.title', meta), options.json);
    } catch (error) {
      printResult(
        io,
        fail('session.title', 'SESSION_TITLE_FAILED', getErrorMessage(error), { sessionId }, [
          'Verify the sessionId exists under .peaks/'
        ]),
        options.json
      );
      process.exitCode = 1;
    }
  });
}

export function registerSessionRotateCommand(session: Command, io: ProgramIO): void {
  addJsonOption(
    session
      .command('rotate')
      .description(
        'Drop the project-level session binding so the next peaks call auto-generates a fresh session id. The on-disk session directory is left intact — only .peaks/.session.json is removed.'
      )
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
      .option(
        '--reason <text>',
        'human-readable reason for the rotation, recorded in the response data'
      )
  ).action((options: { project?: string; reason?: string; json?: boolean }) => {
    try {
      // Canonicalise the project root before touching the binding: `peaks
      // workspace init` writes it realpath-resolved, and readSessionFile's
      // strict projectRoot equality check would otherwise miss a path that
      // came through a symlink (notably /tmp on macOS).
      const projectRoot =
        options.project !== undefined
          ? options.project
          : (findProjectRoot(process.cwd()) ?? process.cwd());
      const previousSessionId = rotateSessionBinding(resolveCanonicalProjectRoot(projectRoot));
      printResult(
        io,
        ok('session.rotate', {
          previousSessionId,
          ...(options.reason !== undefined ? { reason: options.reason } : {}),
          note:
            previousSessionId === null
              ? 'No prior binding was present; the project is already unbound.'
              : 'Next ensureSession() call will auto-generate a fresh id. The previous session directory is still on disk at .peaks/_runtime/<previousSessionId>/.'
        }),
        options.json
      );
    } catch (error) {
      printResult(
        io,
        fail(
          'session.rotate',
          'SESSION_ROTATE_FAILED',
          getErrorMessage(error),
          { projectRoot: options.project },
          ['Verify the project path exists and is writable']
        ),
        options.json
      );
      process.exitCode = 1;
    }
  });
}
