// The session binding every `peaks compact` subcommand resolves through, on its own so
// the five commands that read it share one fix point.
import { getSessionIdCanonical } from '../../services/session/session-manager.js';

/** The active session id, or the refusal envelope every caller prints the same way. */
export function resolveSessionId(
  projectRoot: string,
  explicit: string | undefined
): { sid: string | null; error: { code: string; message: string; nextActions: string[] } | null } {
  if (explicit !== undefined && explicit.length > 0) {
    return { sid: explicit, error: null };
  }
  // Statically-imported `getSessionIdCanonical` (see import block
  // at the top of this file). It is the single source of truth for
  // "what session is bound to this project"; we use it instead of
  // re-implementing the resolution here to keep one fix point when
  // the binding layout changes.
  const sid = getSessionIdCanonical(projectRoot) ?? null;
  if (sid === null) {
    return {
      sid: null,
      error: {
        code: 'NO_ACTIVE_SESSION',
        message:
          'No active session bound. Run `peaks workspace init --project <repo> --json` to bind one.',
        nextActions: [`peaks workspace init --project ${projectRoot} --json`]
      }
    };
  }
  return { sid, error: null };
}
