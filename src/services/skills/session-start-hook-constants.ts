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

/**
 * rid `2026-09-13-a2-post-compact-reinject` — SessionStart entry scoped to
 * `matcher: 'compact'` that puts the engineering state back into the context
 * a compaction just emptied.
 *
 * This is the official mechanism, and the `matcher` is the load-bearing part
 * of it: Claude Code adds a `SessionStart` hook's plain-text stdout to the
 * context, and scoping to `compact` means the card is re-injected AFTER a
 * compaction rather than on every fresh session. Compaction itself cannot be
 * initiated from here — the harness performs it, and a hook can only observe
 * or veto. Re-injection is the half that IS available to us.
 *
 * Why a separate entry instead of folding this into the `peaks session
 * primer` entry that already runs on every SessionStart: the primer's own
 * contract is "rotation + presence cleanup", it fires on `startup` too (where
 * the dispatch context is still in the history and the card would be noise),
 * and its output is a rotation envelope rather than an engineering-state
 * card. Two entries, two intents — each one's output means exactly one thing.
 */
export const HOOK_POST_COMPACT_REINJECT_SENTINEL = 'peaks session reinject';

/**
 * The reinject hook command. `--project "${CLAUDE_PROJECT_DIR}"` matches the
 * other two SessionStart entries: `${CLAUDE_PROJECT_DIR}` is Claude Code's
 * standard project-root convention, and the CLI resolves it strictly (a
 * SessionStart payload is env-driven and must not be trusted as a path).
 *
 * `--quiet-failure` is NOT a flag and deliberately so: printing nothing on
 * failure is this command's unconditional behaviour, not something a caller
 * opts into. See `reinject-command.ts` — stdout IS context here, so an error
 * message on stdout would be injected into the model's context as though
 * peaks-loop meant it.
 */
export const HOOK_POST_COMPACT_REINJECT_COMMAND = `peaks session reinject --project "\${CLAUDE_PROJECT_DIR}"`;

/** SessionStart hook event key (same as outer-cache + primer). */
export const HOOK_POST_COMPACT_REINJECT_EVENT = 'SessionStart';

/**
 * The SessionStart `source` value the re-injection is scoped to. Claude Code
 * reports `compact` as the SessionStart source when the session is resuming
 * from a compaction; the hook entry's `matcher` is matched against it.
 */
export const HOOK_POST_COMPACT_REINJECT_MATCHER = 'compact';

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
