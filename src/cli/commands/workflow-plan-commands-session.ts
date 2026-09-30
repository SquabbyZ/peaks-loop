/**
 * Shared session-id / project-root resolution for the `peaks workflow plan`
 * command family (slice 025).
 *
 * Extracted from `workflow-plan-commands.ts` (strict-remediation c1) so one
 * implementation backs every plan subcommand instead of the per-command copies
 * the slice originally shipped — the same single-source form `request-commands.ts`
 * already uses for its session-id guard (`guardSessionId`). This is a behaviour
 * move, not a logic change: same predicates, same branch order, same envelope.
 */
import { fail } from 'peaks-loop-shared/result';

import { printResult, type ProgramIO } from '../cli-helpers.js';
import { getSessionId } from '../../services/session/session-manager.js';
import { findProjectRoot } from '../../services/config/config-safety.js';

// F-1 (slice 025 security): reject session ids that look like path
// traversal payloads. Canonical pattern is YYYY-MM-DD-<slug>.
const SESSION_ID_PATTERN = /^\d{4}-\d{2}-\d{2}-[a-z][a-z0-9-]*[a-z0-9]$/;

/** The emit context shared by every plan subcommand: where and how to report. */
export interface PlanCommandContext {
  readonly io: ProgramIO;
  readonly command: string;
  readonly asJson: boolean | undefined;
}

export function isValidSessionId(value: string): boolean {
  return SESSION_ID_PATTERN.test(value);
}

function invalidSessionIdResult(ctx: PlanCommandContext, sessionId: string) {
  return fail(
    ctx.command,
    'INVALID_SESSION_ID',
    'session id must match YYYY-MM-DD-slug pattern',
    { sessionId },
    ['Use --session-id <YYYY-MM-DD-slug>']
  );
}

/**
 * Resolve the session id for a plan subcommand: an explicit `--session-id` is
 * validated; otherwise the active session is read and validated defensively. On
 * any rejection the subcommand envelope is printed, the exit code set to 1 and
 * `null` returned so the caller can bail without touching the result path.
 */
export function resolveSessionId(
  ctx: PlanCommandContext,
  projectRoot: string,
  explicit: string | undefined
): string | null {
  if (explicit !== undefined && explicit.length > 0) {
    if (!isValidSessionId(explicit)) {
      printResult(ctx.io, invalidSessionIdResult(ctx, explicit), ctx.asJson === true);
      process.exitCode = 1;
      return null;
    }
    return explicit;
  }
  const sid = getSessionId(projectRoot);
  if (sid === null || sid === undefined) {
    printResult(
      ctx.io,
      fail(
        ctx.command,
        'NO_ACTIVE_SESSION',
        'No active session — pass --session-id explicitly or run peaks workspace init',
        { projectRoot },
        ['Run peaks workspace init or pass --session-id <YYYY-MM-DD-slug>']
      ),
      ctx.asJson === true
    );
    process.exitCode = 1;
    return null;
  }
  // Defensive: even active-session resolution must satisfy the pattern.
  if (!isValidSessionId(sid)) {
    printResult(ctx.io, invalidSessionIdResult(ctx, sid), ctx.asJson === true);
    process.exitCode = 1;
    return null;
  }
  return sid;
}

/** Resolve the project root: an explicit `--project`, else the discovered root. */
export function resolveProjectRoot(projectArg: string | undefined): string {
  if (projectArg === undefined || projectArg === '') {
    return findProjectRoot(process.cwd()) ?? process.cwd();
  }
  return projectArg;
}
