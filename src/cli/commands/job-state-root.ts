// Split out of `job-commands.ts`: the D6
// session-id resolution every `job` subcommand runs before it can address
// `<project>/.peaks/_runtime/<sessionId>/job/<jobId>/state.json`.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isUnsafePathInput } from '../../shared/path-safety.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';
import { projectRoot, type JobRootOpts } from './job-command-shared.js';

/**
 * D6: every job subcommand resolves a job root, so every one of them must be
 * able to name the session that holds the job. Same precedence as the rest of
 * the CLI (`peaks sub-agent dispatch`, `peaks web *`, `peaks share *`), except
 * that job state has no "unknown-sid" location to land in — an unresolvable
 * session is an error, not a silent fallback.
 */
export const SESSION_ID_HELP =
  'session id (default: resolve from .peaks/_runtime/session.json; falls back to PEAKS_SESSION_ID env var; final fallback: NO_ACTIVE_SESSION error)';

/**
 * The session (a direct child of `<project>/.peaks/_runtime/`) that holds
 * `jobId`, or null. Only used to explain a miss: a job that lives in another
 * session must be reported by name so the caller can re-run with --session-id.
 */
function findSessionHoldingJob(project: string, jobId: string): string | null {
  const runtimeDir = join(project, '.peaks', '_runtime');
  if (!existsSync(runtimeDir)) return null;
  for (const entry of readdirSync(runtimeDir, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      existsSync(join(runtimeDir, entry.name, 'job', jobId, 'state.json'))
    ) {
      return entry.name;
    }
  }
  return null;
}

/**
 * Resolves the on-disk root for Job state files.
 *
 * Per spec §3.3 + §4.5 (2.7.1 single-scope-axis layout), Job state lives at:
 *   `<projectRoot>/.peaks/_runtime/<sessionId>/job/<jobId>/state.json`
 *
 * The `JobStateStore` itself only knows its `rootDir` + `jobId` and joins them. We
 * compute the canonical root here (per-call) so the store can stay layout-agnostic.
 *
 * Resolution order (D6 — a job must stay addressable while the single per-project
 * `.peaks/_runtime/session.json` binding points at another session):
 * 1. `--session-id` flag (explicit override)
 * 2. `PEAKS_SESSION_ID` env var
 * 3. `getCurrentSessionId(project)` — this caller's session binding, falling back
 *    to `.peaks/_runtime/session.json` when no caller binding is resolvable
 * 4. Error (NO_ACTIVE_SESSION) — must never silently fall back to a random uuid
 *
 * When `jobId` is passed and it is absent from the resolved session, the thrown
 * error names the session that does hold it (if any), instead of leaving the
 * caller with a bare "no state for <job> at <other-sid>" path.
 */
export function resolveJobStateRoot(
  opts: JobRootOpts,
  jobId?: string
): { rootDir: string; sessionId: string; projectRoot: string } {
  const project = projectRoot(opts);
  const sessionId = opts.sessionId ?? process.env.PEAKS_SESSION_ID ?? getCurrentSessionId(project);
  if (!sessionId) {
    throw new Error(
      'NO_ACTIVE_SESSION: peaks job requires --session-id or an active peaks-code session via peaks workspace init'
    );
  }
  // Sid axis — the sibling of the jobId guard in `JobStateStore.jobDir`. A
  // caller-supplied `--session-id` reaches this join unmodified, so a
  // traversal value lands `job/<id>/state.json` outside every project root
  // while the envelope still reads `ok: true`.
  if (isUnsafePathInput(sessionId)) {
    throw new Error(`Invalid session id: ${sessionId} (must be a single path segment)`);
  }
  const rootDir = join(project, '.peaks', '_runtime', sessionId, 'job');
  if (jobId && !existsSync(join(rootDir, jobId, 'state.json'))) {
    const other = findSessionHoldingJob(project, jobId);
    throw new Error(
      other
        ? `JOB_NOT_IN_SESSION: no job "${jobId}" in session "${sessionId}"; it lives in session "${other}" — re-run with --session-id ${other}`
        : `JOB_NOT_IN_SESSION: no job "${jobId}" in session "${sessionId}" (and no other session under .peaks/_runtime/ has it)`
    );
  }
  return { rootDir, sessionId, projectRoot: project };
}
