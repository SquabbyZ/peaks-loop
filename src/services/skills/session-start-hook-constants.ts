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
 *
 * Slice rid-statusline-stale-ux AC-2: renamed from
 * `outer-cache-hook-constants.ts` (per RD §10 M-3) and extended with
 * the SessionStart workspace-init primer constants. The primer fires
 * `peaks session primer --project <path>` immediately after the
 * outer-cache write so rotation + presence cleanup run BEFORE the
 * first statusline render of a fresh session.
 */

/** Sentinel substring identifying a SessionStart outer-cache hook entry. */
export const HOOK_OUTER_CACHE_SENTINEL = 'peaks outer-cache write';

/** Default (claude-code) SessionStart hook command. */
export const HOOK_OUTER_CACHE_COMMAND = `peaks outer-cache write --project "\${CLAUDE_PROJECT_DIR}"`;

/** SessionStart hook event key for Claude Code. */
export const HOOK_OUTER_CACHE_EVENT = 'SessionStart';

/**
 * Slice rid-statusline-stale-ux AC-2: SessionStart workspace-init
 * primer sentinel. Identifies the SessionStart entry that runs
 * `peaks session primer --project <path>` so rotation + presence
 * cleanup fire on every fresh session, before the first statusline
 * render of that session. The primer is idempotent and short-
 * circuits when the binding already matches.
 */
export const HOOK_WORKSPACE_INIT_SENTINEL = 'peaks session primer';

/** SessionStart hook command for the primer. */
export const HOOK_WORKSPACE_INIT_COMMAND = `peaks session primer --project "\${CLAUDE_PROJECT_DIR}"`;

/** SessionStart hook event key (same as outer-cache). */
export const HOOK_WORKSPACE_INIT_EVENT = 'SessionStart';
