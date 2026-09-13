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

/**
 * rid `2026-09-13-compact-event-settle` — the `PostCompact` entry that lets the
 * harness's own event settle a compact, instead of the next `context-now` probe
 * inferring one from a ratio that fell.
 *
 * WHY THIS ENTRY IS NOT A `SessionStart` ONE, despite living in this file: the
 * three entries above all ride `SessionStart` and differ only by matcher. A
 * `PostCompact` hook is a different EVENT that carries the one fact no
 * `SessionStart` payload has — whether the compaction the harness just
 * completed was `auto` or `manual`. That distinction is the whole question
 * ("has this machine ever auto-compacted?"), and without it peaks-loop can only
 * ever see that SOMETHING compacted. See `compact-event-settle.ts` for what the
 * command does with it.
 *
 * WHY THE MATCHER IS THE EMPTY STRING and not the documented `auto|manual`:
 * both trigger values are wanted, so the matcher must filter nothing. An empty
 * matcher is the convention the three `SessionStart` entries already rely on to
 * match every source, and it is the only form that cannot fail SILENTLY — an
 * alternation string is a match-everything pattern under regex semantics but
 * matches NEITHER value under exact-equality semantics, and a hook that never
 * fires looks exactly like a hook with nothing to report.
 */
export const HOOK_COMPACT_SETTLE_SENTINEL = 'peaks compact settle';

/**
 * The settle hook command. `--project "${CLAUDE_PROJECT_DIR}"` is byte-for-byte
 * the shape of the three `SessionStart` entries above — Claude Code's standard
 * project-root convention, resolved strictly on the CLI side (a hook payload is
 * env-driven and must not be trusted as a path).
 *
 * The command prints NOTHING on the hook path and exits 0 for every outcome.
 * `PostCompact`'s stdin/stdout contract is truncated in the retrievable docs,
 * so the safe assumption is the `SessionStart` one — stdout may be added to the
 * model's context. An error message there would be read as a fact. See
 * `compact-event-settle.ts`.
 *
 * No `shell` pin, deliberately: this entry lands in the shared, committed
 * `.claude/settings.json`, and a `powershell` pin there would break every
 * macOS / Linux reader of the file. See `resolveHookEntries`' comment block for
 * the full reason the three `SessionStart` entries are unpinned too.
 */
export const HOOK_COMPACT_SETTLE_COMMAND = `peaks compact settle --project "\${CLAUDE_PROJECT_DIR}"`;

/** The event this entry rides. Claude Code fires it after a compaction completes. */
export const HOOK_COMPACT_SETTLE_EVENT = 'PostCompact';

/** Matcher: empty = every `trigger` (`auto` and `manual`). See the sentinel doc. */
export const HOOK_COMPACT_SETTLE_MATCHER = '';
