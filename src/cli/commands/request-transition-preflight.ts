// Split out of `request-commands.ts`: the
// pre-transition refusals `peaks request transition` runs before it touches an
// artifact — session-id resolution, the `--allow-incomplete` reason rule, and
// the assisted/strict-mode bypass gate.
import { join } from 'node:path';
import { fail } from 'peaks-loop-shared/result';
import { isUnsafePathInput } from '../../shared/path-safety.js';
import { printResult, type ProgramIO } from '../cli-helpers.js';
import {
  isBypassLimitReached,
  recordBypass,
  MAX_BYPASSES_PER_SESSION
} from '../../services/mode/bypass-tracker.js';
import {
  showRequestArtifact,
  type RequestArtifactRole
} from '../../services/artifacts/request-artifact-service.js';
import type { RequestTransitionOptions } from './request-command-options.js';

export type TransitionPreflight =
  { proceed: true; resolvedSessionId: string | undefined } | { proceed: false };

type BypassContext = {
  requestId: string;
  role: RequestArtifactRole;
  options: RequestTransitionOptions;
  resolvedSessionId: string | undefined;
};

function refuseInvalidSession(
  io: ProgramIO,
  options: RequestTransitionOptions,
  resolvedSessionId: string
): void {
  printResult(
    io,
    fail(
      'request.transition',
      'INVALID_SESSION_ID',
      `Invalid session id: ${resolvedSessionId} (must be a single path segment)`,
      { provided: resolvedSessionId },
      ['Pass a session id that is a single path segment']
    ),
    options.json
  );
  process.exitCode = 1;
}

/**
 * Resolve the artifact's real session up front. Falling back to a literal
 * 'default' (the previous behavior) points the bypass counter at a
 * non-existent .peaks/default/ dir and crashes with ENOENT, so when
 * --session-id is omitted we look the artifact up to find its session.
 * Returns `null` when a refusal was printed.
 */
async function resolveTransitionSessionId(
  io: ProgramIO,
  requestId: string,
  role: RequestArtifactRole,
  options: RequestTransitionOptions
): Promise<string | undefined | null> {
  let resolvedSessionId = options.sessionId;
  // Sid axis: either arm of `resolvedSessionId` can be a caller-supplied
  // `--session-id`, and it is joined into the bypass-counter root below.
  if (resolvedSessionId !== undefined && isUnsafePathInput(resolvedSessionId)) {
    refuseInvalidSession(io, options, resolvedSessionId);
    return null;
  }
  if (resolvedSessionId === undefined) {
    const located = await showRequestArtifact({ projectRoot: options.project, role, requestId });
    if (located !== null) {
      resolvedSessionId = located.sessionId;
    }
  }
  return resolvedSessionId;
}

function refuseBypassReasonRequired(io: ProgramIO, ctx: BypassContext): void {
  printResult(
    io,
    fail(
      'request.transition',
      'BYPASS_REASON_REQUIRED',
      '--allow-incomplete requires --reason explaining why prerequisites are skipped',
      { role: ctx.role, requestId: ctx.requestId },
      [
        'Add --reason "<short justification>" or remove --allow-incomplete and produce the missing artifacts'
      ]
    ),
    ctx.options.json
  );
  process.exitCode = 1;
}

function refuseAllowIncompleteRestricted(io: ProgramIO, ctx: BypassContext, mode: string): void {
  printResult(
    io,
    fail(
      'request.transition',
      'ALLOW_INCOMPLETE_RESTRICTED',
      `--allow-incomplete requires --confirm in ${mode} mode`,
      { role: ctx.role, requestId: ctx.requestId, mode },
      [
        'Ask the user via AskUserQuestion whether to proceed, then re-run with --confirm if they approve.'
      ]
    ),
    ctx.options.json
  );
  process.exitCode = 1;
}

function refuseBypassLimitReached(io: ProgramIO, ctx: BypassContext): void {
  printResult(
    io,
    fail(
      'request.transition',
      'BYPASS_LIMIT_REACHED',
      `--allow-incomplete limit reached (${MAX_BYPASSES_PER_SESSION} per session)`,
      { role: ctx.role, requestId: ctx.requestId, limit: MAX_BYPASSES_PER_SESSION },
      ['Produce the missing artifacts instead of bypassing.']
    ),
    ctx.options.json
  );
  process.exitCode = 1;
}

/**
 * Restrict --allow-incomplete in assisted/strict modes: require --confirm,
 * then count the bypass under the canonical session home
 * `.peaks/_runtime/<sid>/`, NOT `.peaks/_runtime/<sid>/`. The legacy path
 * landed `.bypass-count.json` at the project root and was ignored only by
 * `.gitignore`, not by the runtime — a back-compat reader on the root would
 * never see it. The canonical home is the same one `peaks session info
 * --active` resolves from `_runtime/session.json`, so all session-scoped state
 * (artifacts + bypass counter) now lives in one tree.
 */
async function applyRestrictedBypassGate(io: ProgramIO, ctx: BypassContext): Promise<boolean> {
  const { options, resolvedSessionId } = ctx;
  const { getSkillPresence } = await import('../../services/skills/skill-presence-service.js');
  const presence = getSkillPresence(options.project);
  if (!(presence?.mode === 'assisted' || presence?.mode === 'strict')) return true;
  if (options.confirm !== true) {
    refuseAllowIncompleteRestricted(io, ctx, presence.mode);
    return false;
  }
  const sessionRoot = join(options.project, '.peaks', '_runtime', resolvedSessionId ?? 'default');
  if (isBypassLimitReached(sessionRoot)) {
    refuseBypassLimitReached(io, ctx);
    return false;
  }
  recordBypass(sessionRoot);
  return true;
}

async function checkBypassPreconditions(io: ProgramIO, ctx: BypassContext): Promise<boolean> {
  const { options } = ctx;
  if (
    options.allowIncomplete === true &&
    (options.reason === undefined || options.reason.trim().length === 0)
  ) {
    refuseBypassReasonRequired(io, ctx);
    return false;
  }
  if (options.allowIncomplete === true && options.forceConfirm !== true) {
    return applyRestrictedBypassGate(io, ctx);
  }
  return true;
}

export async function runTransitionPreflight(
  io: ProgramIO,
  requestId: string,
  role: RequestArtifactRole,
  options: RequestTransitionOptions
): Promise<TransitionPreflight> {
  const resolvedSessionId = await resolveTransitionSessionId(io, requestId, role, options);
  if (resolvedSessionId === null) return { proceed: false };
  const allowed = await checkBypassPreconditions(io, {
    requestId,
    role,
    options,
    resolvedSessionId
  });
  if (!allowed) return { proceed: false };
  return { proceed: true, resolvedSessionId };
}
