/**
 * Slice 2026-08-06-session-outer-cache (G2): per-IDE SessionStart hook
 * constants for the outer-session cache primer. Extracted from
 * `hooks-settings-service.ts` to keep that file under the Karpathy
 * 800 LOC cap.
 *
 * The SessionStart hook is fired by Claude Code (and any future IDE
 * that ships a SessionStart-style event) every time a new outer
 * session begins. It runs `peaks outer-cache write`, which reads
 * PEAKS_OUTER_SESSION_ID ?? CLAUDE_CODE_SESSION_ID from env and
 * persists it to `.peaks/_runtime/.outer-session-cache.json` so the
 * next peaks CLI sub-process can resolve the current outer session
 * via `getCurrentOuterSessionId(projectRoot)`.
 *
 * Only Claude Code supports SessionStart today; future adapters opt
 * in by extending `resolveHookEntries` and adding an adapter-driven
 * substitution for the `${...}` project-dir placeholder.
 */

/** Sentinel substring identifying a SessionStart outer-cache hook entry. */
export const HOOK_OUTER_CACHE_SENTINEL = 'peaks outer-cache write';

/** Default (claude-code) SessionStart hook command. */
export const HOOK_OUTER_CACHE_COMMAND = `peaks outer-cache write --project "\${CLAUDE_PROJECT_DIR}"`;

/** SessionStart hook event key for Claude Code. */
export const HOOK_OUTER_CACHE_EVENT = 'SessionStart';
