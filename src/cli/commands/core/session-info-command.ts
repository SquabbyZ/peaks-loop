import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getSessionMeta } from '../../../services/session/session-manager.js';
import { resolveCanonicalProjectRoot } from '../../../services/config/config-service.js';
import { findProjectRoot } from '../../../services/config/config-safety.js';
import type { CallerIdSource } from '../../../services/session/caller-id-types.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../../cli-helpers.js';
import type { BindingSource } from './doctor-command.js';

type SessionInfoOptions = {
  json?: boolean;
  active?: boolean;
  project?: string;
  callerId?: string;
};

/** Exit codes for a rejected `--caller-id`, by the resolver's own errno. */
const EXIT_USAGE = 64;
const EXIT_DATAERR = 65;

/** The advisory that rides every read off the pre-canonical binding dotfile. */
const LEGACY_WARNING =
  'Read from legacy back-compat path .peaks/.session.json. Run `peaks workspace reconcile --apply` to migrate to the canonical home (.peaks/_runtime/session.json).';

/** `canonical` = `.peaks/_runtime/session.json`; `legacy` = `.peaks/.session.json`. */
function bindingSourceOf(projectRoot: string): BindingSource {
  return existsSync(join(projectRoot, '.peaks', '_runtime', 'session.json'))
    ? 'canonical'
    : 'legacy';
}

function bindingPathOf(projectRoot: string, source: BindingSource): string {
  return source === 'canonical'
    ? join(projectRoot, '.peaks', '_runtime', 'session.json')
    : join(projectRoot, '.peaks', '.session.json');
}

/** A `--caller-id` the resolver rejected (D5 → exit 65; EX_USAGE → exit 64). */
function emitCallerIdInvalid(
  io: ProgramIO,
  options: SessionInfoOptions,
  error: { message: string; source: CallerIdSource; code: 'EX_USAGE' | 'EX_DATAERR' }
): void {
  printResult(
    io,
    fail('session.info', 'CALLER_ID_INVALID', error.message, { source: error.source }, [
      `Set --caller-id to a value matching ^[a-zA-Z0-9._-]{1,200}$`,
      'Or set PEAKS_CALLER_ID env var (or CLAUDE_CODE_SESSION_ID for Claude Code)'
    ]),
    options.json
  );
  process.exitCode = error.code === 'EX_USAGE' ? EXIT_USAGE : EXIT_DATAERR;
}

/**
 * `--caller-id` together with `--active`: look up the binding this callerId
 * holds, so the envelope carries both the resolved id and its peak session.
 */
async function emitCallerBinding(
  io: ProgramIO,
  options: SessionInfoOptions,
  projectRoot: string,
  callerId: string
): Promise<void> {
  const { getSessionIdCanonical } = await import('../../../services/session/session-manager.js');
  const { getCallerBinding } = await import('../../../services/session/caller-binding-service.js');
  const callerBinding = getCallerBinding(projectRoot, callerId);
  printResult(
    io,
    ok('session.info', {
      active: true,
      sessionId: getSessionIdCanonical(projectRoot),
      callerId,
      callerBindingPeakSessionId: callerBinding?.peakSessionId ?? null,
      source: bindingSourceOf(projectRoot)
    }),
    options.json
  );
}

/**
 * Resolve `--caller-id` (D1/D5 validation) and report it. An invalid flag
 * throws `CallerIdError`, which is surfaced as `CALLER_ID_INVALID`; anything
 * else propagates.
 */
async function emitCallerIdPath(
  io: ProgramIO,
  options: SessionInfoOptions,
  projectRoot: string,
  flagValue: string
): Promise<void> {
  const { resolveCallerId, CallerIdError } =
    await import('../../../services/session/resolve-caller-id.js');
  let callerId: string;
  try {
    callerId = resolveCallerId({ flagValue });
  } catch (error: unknown) {
    if (error instanceof CallerIdError) {
      emitCallerIdInvalid(io, options, error);
      return;
    }
    throw error;
  }
  if (options.active === true) {
    await emitCallerBinding(io, options, projectRoot, callerId);
    return;
  }
  printResult(
    io,
    ok('session.info', {
      callerId,
      note: '--caller-id resolved; pass --active to also look up the bound peak session'
    }),
    options.json
  );
}

/**
 * `--active` without `--caller-id`: the SOLE authoritative lookup of the
 * active session id — composes on `getSessionIdCanonical`
 * (canonicalize-on-read) and falls through to `getSessionId`
 * (strict-equality) for callers on the original contract. NEITHER path calls
 * `ensureSession()` — that would side-effect-create a fresh binding on miss,
 * erasing the "no active session" signal sub-agents rely on.
 */
async function emitActiveBinding(
  io: ProgramIO,
  options: SessionInfoOptions,
  projectRoot: string
): Promise<void> {
  const { getSessionIdCanonical, getSessionId } =
    await import('../../../services/session/session-manager.js');
  let activeSid = getSessionIdCanonical(projectRoot);
  if (activeSid === null) activeSid = getSessionId(projectRoot);
  if (activeSid === null) {
    printResult(
      io,
      fail(
        'session.info',
        'NO_ACTIVE_SESSION',
        'No session bound. Run `peaks workspace init --project <repo> --json` to bind one.',
        { projectRoot },
        [`peaks workspace init --project ${projectRoot} --json`]
      ),
      options.json
    );
    process.exitCode = 1;
    return;
  }
  const source = bindingSourceOf(projectRoot);
  printResult(
    io,
    ok(
      'session.info',
      {
        active: true,
        sessionId: activeSid,
        bindingPath: bindingPathOf(projectRoot, source),
        projectRoot,
        source
      },
      source === 'legacy' ? [LEGACY_WARNING] : []
    ),
    options.json
  );
}

/** Explicit `<sessionId>`: read that session's metadata, or refuse. */
function emitSessionById(
  io: ProgramIO,
  sessionId: string | undefined,
  options: SessionInfoOptions,
  projectRoot: string
): void {
  if (sessionId === undefined) {
    printResult(
      io,
      fail(
        'session.info',
        'SESSION_ID_REQUIRED',
        'session.info requires a <sessionId> or --active',
        {},
        ['Pass a <sessionId> argument, or use --active to resolve the canonical binding']
      ),
      options.json
    );
    process.exitCode = 1;
    return;
  }
  const meta = getSessionMeta(projectRoot, sessionId);
  if (meta === null) {
    printResult(
      io,
      fail(
        'session.info',
        'SESSION_NOT_FOUND',
        `Session "${sessionId}" not found or has no metadata`,
        { sessionId },
        ['Use `peaks session list` to see available sessions']
      ),
      options.json
    );
    process.exitCode = 1;
    return;
  }
  printResult(io, ok('session.info', meta), options.json);
}

async function runSessionInfo(
  io: ProgramIO,
  sessionId: string | undefined,
  options: SessionInfoOptions
): Promise<void> {
  const projectRoot =
    options.project !== undefined
      ? resolveCanonicalProjectRoot(options.project)
      : (findProjectRoot(process.cwd()) ?? process.cwd());
  if (options.callerId !== undefined) {
    await emitCallerIdPath(io, options, projectRoot, options.callerId);
    return;
  }
  if (options.active === true) {
    await emitActiveBinding(io, options, projectRoot);
    return;
  }
  emitSessionById(io, sessionId, options, projectRoot);
}

export function registerSessionInfoCommand(session: Command, io: ProgramIO): void {
  addJsonOption(
    session
      .command('info [sessionId]')
      .description(
        'Show full metadata for a session directory. Pass --active to resolve the canonical binding from .peaks/_runtime/session.json (the "one command a sub-agent runs to find the parent\'s sid" primitive). Slice 021: --active is the SOLE authoritative way to look up the active session id; the on-disk file path is internal and must NOT be `cat`-ed directly.'
      )
      .option(
        '--active',
        'resolve the canonical session id from .peaks/_runtime/session.json (ignores [sessionId] when set)'
      )
      .option(
        '--project <path>',
        'target project root (defaults to git root or cwd). Slice 021: lets sub-agents skip the cwd heuristic and look up the binding for a specific repo.'
      )
      // overrides the per-process PEAKS_CALLER_ID env var and the
      // PLATFORM_FALLBACKS table (D4 priority). The resolved callerId is
      // surfaced in the JSON envelope so callers can confirm what was
      // resolved without re-deriving it.
      .option(
        '--caller-id <id>',
        'Override the caller id for this invocation (D4 priority: flag beats env beats platform fallback). When set, the response envelope includes the resolved callerId.'
      )
  ).action((sessionId: string | undefined, options: SessionInfoOptions) =>
    runSessionInfo(io, sessionId, options)
  );
}
