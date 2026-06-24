import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getSessionMeta, rotateSessionBinding, setSessionTitle, listSessionMetas } from '../../../services/session/session-manager.js';
import { resolveCanonicalProjectRoot } from '../../../services/config/config-service.js';
import { findProjectRoot } from '../../../services/config/config-safety.js';
import { fail, ok } from '../../../shared/result.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../../cli-helpers.js';
import type { BindingSource } from './doctor-command.js';

export function registerSessionCommand(program: Command, io: ProgramIO): void {
  const session = program.command('session').description('Manage Peaks session directories');

  addJsonOption(
    session
      .command('list')
      .description('List all session directories with titles and metadata')
  ).action((options: { json?: boolean }) => {
    const projectRoot = findProjectRoot(process.cwd()) ?? process.cwd();
    const metas = listSessionMetas(projectRoot);
    printResult(io, ok('session.list', { sessions: metas, total: metas.length }), options.json);
  });

  addJsonOption(
    session
      .command('info [sessionId]')
      .description('Show full metadata for a session directory. Pass --active to resolve the canonical binding from .peaks/_runtime/session.json (the "one command a sub-agent runs to find the parent\'s sid" primitive). Slice 021: --active is the SOLE authoritative way to look up the active session id; the on-disk file path is internal and must NOT be `cat`-ed directly.')
      .option('--active', 'resolve the canonical session id from .peaks/_runtime/session.json (ignores [sessionId] when set)')
      .option('--project <path>', 'target project root (defaults to git root or cwd). Slice 021: lets sub-agents skip the cwd heuristic and look up the binding for a specific repo.')
      // Slice 020 — caller-keyed session binding. The --caller-id flag
      // overrides the per-process PEAKS_CALLER_ID env var and the
      // PLATFORM_FALLBACKS table (D4 priority). The resolved callerId is
      // surfaced in the JSON envelope so callers can confirm what was
      // resolved without re-deriving it.
      .option('--caller-id <id>', 'Override the caller id for this invocation (D4 priority: flag beats env beats platform fallback). When set, the response envelope includes the resolved callerId.')
  ).action(async (sessionId: string | undefined, options: { json?: boolean; active?: boolean; project?: string; callerId?: string }) => {
    // Slice 021: --project wins; otherwise the git-root / cwd fallback
    // (matches the pre-021 behaviour so the existing slice-020 / slice-007
    // sub-agent flow keeps working unchanged).
    const projectRoot = options.project !== undefined
      ? resolveCanonicalProjectRoot(options.project)
      : (findProjectRoot(process.cwd()) ?? process.cwd());
    // Slice 020 — resolve the callerId up front when the flag was passed.
    // We use `resolveCallerId` for D1/D5 validation; an invalid flag
    // throws CallerIdError (D5 → exit 65). A missing flag and no env
    // and no fallback also throws (D2 → exit 64). The resolved id is
    // surfaced in the envelope so the caller can audit.
    if (options.callerId !== undefined) {
      const { resolveCallerId, CallerIdError } = await import('../../../services/session/resolve-caller-id.js');
      let callerId: string;
      try {
        callerId = resolveCallerId({ flagValue: options.callerId });
      } catch (error: unknown) {
        if (error instanceof CallerIdError) {
          const code = error.code === 'EX_USAGE' ? 64 : 65;
          printResult(io, fail('session.info', 'CALLER_ID_INVALID', error.message, { source: error.source }, [`Set --caller-id to a value matching ^[a-zA-Z0-9._-]{1,200}$`, 'Or set PEAKS_CALLER_ID env var (or CLAUDE_CODE_SESSION_ID for Claude Code)']), options.json);
          process.exitCode = code;
          return;
        }
        throw error;
      }
      // Surface the resolved id in the envelope. When --active is also
      // passed, look up the binding for this callerId; otherwise
      // just emit the resolved id so the caller knows what was used.
      if (options.active === true) {
        const { getSessionIdCanonical } = await import('../../../services/session/session-manager.js');
        const { getCallerBinding } = await import('../../../services/session/caller-binding-service.js');
        const activeSid = getSessionIdCanonical(projectRoot);
        const callerBinding = getCallerBinding(projectRoot, callerId);
        // Slice 021: source is the enum that the unified --active primitive
        // reports. Callers / migration tooling can detect pre-migration trees
        // by inspecting `source === 'legacy'`.
        const bindingSource: BindingSource = existsSync(join(projectRoot, '.peaks', '_runtime', 'session.json'))
          ? 'canonical'
          : 'legacy';
        printResult(io, ok('session.info', {
          active: true,
          sessionId: activeSid,
          callerId,
          callerBindingPeakSessionId: callerBinding?.peakSessionId ?? null,
          source: bindingSource
        }), options.json);
        return;
      }
      printResult(io, ok('session.info', { callerId, note: '--caller-id resolved; pass --active to also look up the bound peak session' }), options.json);
      return;
    }
    // Slice 007 + slice 021 — sub-agent session sharing. A sub-agent that
    // does not know the parent's sid reads it from the binding via
    // `peaks session info --active`. Slice 021 turned this into the
    // SOLE authoritative discovery primitive: it composes on
    // getSessionIdCanonical (canonicalize-on-read; handles the stored
    // "projectRoot: '.'" vs caller-passed absolute realpath mismatch
    // that the F22 fix addressed) AND falls through to getSessionId
    // (strict-equality) for callers on the original contract. NEITHER
    // path may call ensureSession() — that would side-effect-create a
    // fresh binding on miss, erasing the "no active session" signal
    // sub-agents rely on.
    if (options.active === true) {
      // Import lazily to avoid a cycle with workspace-commands.
      const { getSessionIdCanonical, getSessionId } = await import('../../../services/session/session-manager.js');
      // 1. Canonicalize-on-read first.
      let activeSid = getSessionIdCanonical(projectRoot);
      // 2. Fall through to the strict-equality reader if the canonical
      //    miss is a projectRoot-form mismatch (e.g. the binding was
      //    written with the absolute realpath but the caller's form
      //    normalizes differently). The 2-read fan-out mirrors the
      //    fallback ensureSession() uses.
      if (activeSid === null) {
        activeSid = getSessionId(projectRoot);
      }
      if (activeSid === null) {
        // 3. No binding at all — fail loudly, NO crash, NO side-effect,
        //    exit 1, message must point at `peaks workspace init`
        //    (the canonical "first action" command, not the legacy
        //    "or `peaks skill presence:set`" hedge that the pre-021
        //    wording used — presence:set would also need a binding to
        //    resolve the parent sid, so it's not actually a bootstrap
        //    path).
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
      // 4. Determine the on-disk source so callers (and future
      //    migration tooling) can detect pre-migration trees. The
      //    canonical file is preferred when both exist (slice 005
      //    contract).
      const bindingSource: BindingSource = existsSync(join(projectRoot, '.peaks', '_runtime', 'session.json'))
        ? 'canonical'
        : 'legacy';
      // Slice 021: when only the legacy back-compat path is present,
      // surface a warning so callers (and humans tailing the JSON)
      // see "this tree has not been reconciled to the canonical
      // home yet". The warning is informational; the binding is
      // still valid for one minor release (slice 005 / 006
      // contract). `warnings` is a top-level envelope field, not a
      // data field, so it goes through ok()'s 3rd positional arg.
      const legacyWarnings = bindingSource === 'legacy'
        ? ['Read from legacy back-compat path .peaks/.session.json. Run `peaks workspace reconcile --apply` to migrate to the canonical home (.peaks/_runtime/session.json).']
        : [];
      printResult(
        io,
        ok(
          'session.info',
          {
            active: true,
            sessionId: activeSid,
            bindingPath: bindingSource === 'canonical'
              ? join(projectRoot, '.peaks', '_runtime', 'session.json')
              : join(projectRoot, '.peaks', '.session.json'),
            projectRoot,
            source: bindingSource
          },
          legacyWarnings
        ),
        options.json
      );
      return;
    }
    if (sessionId === undefined) {
      printResult(io, fail('session.info', 'SESSION_ID_REQUIRED', 'session.info requires a <sessionId> or --active', {}, ['Pass a <sessionId> argument, or use --active to resolve the canonical binding']), options.json);
      process.exitCode = 1;
      return;
    }
    const meta = getSessionMeta(projectRoot, sessionId);
    if (meta === null) {
      printResult(io, fail('session.info', 'SESSION_NOT_FOUND', `Session "${sessionId}" not found or has no metadata`, { sessionId }, ['Use `peaks session list` to see available sessions']), options.json);
      process.exitCode = 1;
      return;
    }
    printResult(io, ok('session.info', meta), options.json);
  });

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
      printResult(io, fail('session.title', 'SESSION_TITLE_FAILED', getErrorMessage(error), { sessionId }, ['Verify the sessionId exists under .peaks/']), options.json);
      process.exitCode = 1;
    }
  });

  // Slice 011: `peaks session checkpoint` and `peaks session resume`.
  // Skill-level primitives — the LLM is the decision-maker; CLI is the muscle.
  // Lazy-import to avoid circular resolution with the session-manager.
  void (async () => {
    const { registerSessionCheckpointCommand } = await import('../session-checkpoint-command.js');
    const { registerSessionResumeCommand } = await import('../session-resume-command.js');
    registerSessionCheckpointCommand(session, io);
    registerSessionResumeCommand(session, io);
  })();

  addJsonOption(
    session
      .command('rotate')
      .description('Drop the project-level session binding so the next peaks call auto-generates a fresh session id. The on-disk session directory is left intact — only .peaks/.session.json is removed.')
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
      .option('--reason <text>', 'human-readable reason for the rotation, recorded in the response data')
  ).action(async (options: { project?: string; reason?: string; json?: boolean }) => {
    try {
      // Canonicalise the project root before touching the binding.
      // `peaks workspace init` writes the binding with the
      // realpath-resolved projectRoot; if the caller passes a path
      // through a symlink (notably /tmp on macOS, which is a
      // symlink to /private/tmp) without canonicalising here,
      // readSessionFile's strict projectRoot equality check fails
      // and the rotate call reports "no prior binding" even
      // though one exists. The same fix as `workspace init`
      // (b193714): promote the path to the git root, falling back
      // to the heuristic, falling back to cwd verbatim.
      const projectRoot = options.project !== undefined
        ? options.project
        : (findProjectRoot(process.cwd()) ?? process.cwd());
      const canonical = resolveCanonicalProjectRoot(projectRoot);
      const previousSessionId = rotateSessionBinding(canonical);
      printResult(io, ok('session.rotate', {
        previousSessionId,
        ...(options.reason !== undefined ? { reason: options.reason } : {}),
        note: previousSessionId === null
          ? 'No prior binding was present; the project is already unbound.'
          : 'Next ensureSession() call will auto-generate a fresh id. The previous session directory is still on disk at .peaks/_runtime/<previousSessionId>/.'
      }), options.json);
    } catch (error) {
      printResult(io, fail('session.rotate', 'SESSION_ROTATE_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Verify the project path exists and is writable']), options.json);
      process.exitCode = 1;
    }
  });
}
