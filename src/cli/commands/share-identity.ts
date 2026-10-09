/**
 * Identity resolution for the `peaks sub-agent share` family envelopes.
 * Extracted from `share-commands.ts` so the runners can share one definition of
 * how a session id is chosen, instead of each repeating the same fallback chain.
 */
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';

/**
 * The session id for a `share` / `shared-read` / `await` envelope: an explicit
 * `--session-id` wins, then `PEAKS_SESSION_ID`, then the id resolved from
 * `.peaks/_runtime/session.json` under `projectRoot`, then the literal
 * `"unknown-sid"` fallback.
 *
 * `peaks sub-agent finalize` deliberately uses a DIFFERENT chain (it never
 * consults the env var), so it keeps its own resolution rather than calling
 * this helper.
 */
export function resolveSessionId(options: { sessionId?: string }, projectRoot: string): string {
  return (
    options.sessionId ??
    process.env.PEAKS_SESSION_ID ??
    getCurrentSessionId(projectRoot) ??
    'unknown-sid'
  );
}
