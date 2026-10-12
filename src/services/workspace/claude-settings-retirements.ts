/**
 * `claude-settings-retirements.ts` — the `hooks.PreToolUse` entries this template
 * used to declare and has since RETIRED, plus the shape predicate the retirement
 * is tested against.
 *
 * WHY A RETIREMENT IS NOT A DELETION. `mergeTemplateOwnedHooks` (in
 * `claude-settings-template-merge.ts`) carries across every on-disk entry the
 * template does not declare — that is the whole point of the entry-level
 * ownership rule, and it is what keeps `installAutoCompactHook`'s `Bash|Task`
 * entry alive across an init. So simply STOPPING the emission reaches nobody: an
 * install written by an earlier release keeps the entry forever. Declaring less
 * cannot retire an entry; something has to say "this one is gone", and
 * `isRetiredTemplateEntry` is that something. `templateContentMatches` calls it
 * too, because a file still carrying a retired entry has to compare as DRIFTED or
 * the merge that would drop it never runs.
 *
 * Extracted from `claude-settings-template-merge.ts` when the second retirement
 * pushed that module past the 300-line cap. The bodies moved verbatim; the
 * predicate and its two shape types came along because the predicate is their
 * only reader inside that module.
 *
 * TWO RETIREMENTS SO FAR:
 *   - TEMPLATE_VERSION 1.8.0 — the `Write|Edit|MultiEdit` gate handler;
 *   - TEMPLATE_VERSION 1.10.0 — the two layer-B feedback hooks.
 * They share neither a matcher nor a command form, so each gets its own narrow
 * predicate rather than one looser rule. The narrowness is load-bearing: a
 * predicate that dropped "anything on this matcher" would delete a USER's hook,
 * which is the failure the ownership rule exists to prevent.
 */

/** One handler in a `hooks.PreToolUse` entry, in the shape this template declares. */
export type TemplateHookCommand = { type: string; command: string; shell?: string };

/**
 * One `hooks.PreToolUse` entry in the shape this template declares. The
 * `matcher` + `hooks` pair is the entry's identity everywhere in this concern:
 * `matcher` alone is not unique (two `Bash` entries), and whole-object identity
 * would make a hand-edited entry unrecognizable and therefore unrepairable.
 */
export type TemplatePreToolUseEntry = { matcher: string; hooks: TemplateHookCommand[] };

export function isPreToolUseEntry(value: unknown): value is TemplatePreToolUseEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as { matcher?: unknown; hooks?: unknown };
  return typeof candidate.matcher === 'string' && Array.isArray(candidate.hooks);
}

/**
 * The retired `Write|Edit|MultiEdit` gate entry, as an on-disk file written by a
 * pre-1.8.0 release holds it.
 *
 * TEMPLATE_VERSION 1.8.0 stopped emitting this entry. Declaring less is not
 * enough on its own: `mergeTemplateOwnedHooks` preserves every on-disk entry the
 * template does not declare — that is the whole point of the entry-level
 * ownership rule (it is what keeps `installAutoCompactHook`'s `Bash|Task` entry
 * alive) — so a project installed by an earlier release would keep the no-op
 * handler, and its `node "C:/…/nvm/v24.14.0/…"` path, forever.
 *
 * Deliberately narrow. It matches the exact command shape this template used to
 * emit — one handler, `node "<…>/services/hooks/write-gate.js"` — under the exact
 * legacy matcher spelling, so a user's OWN `Write|Edit|MultiEdit` entry (a
 * different command, or more than one handler) is preserved like any other entry
 * the template does not declare.
 */
const RETIRED_WRITE_GATE_MATCHER = 'Write|Edit|MultiEdit';
const RETIRED_WRITE_GATE_COMMAND = /^node "[^"]*\/services\/hooks\/write-gate\.js"$/;

/**
 * The two layer-B feedback hooks TEMPLATE_VERSION 1.10.0 retired, as a file
 * written by 1.9.0 holds them.
 *
 * 1.9.0 emitted them into the CONSUMER template on purpose, to make the promotion
 * a property of a fresh clone rather than of one machine. The template cannot do
 * that: it is written into a consumer project's `.claude/settings.local.json`,
 * where `${CLAUDE_PROJECT_DIR}` is the CONSUMER's root, `src/**` is absent from
 * the npm `files` list, and nothing copies it — so every downstream project
 * received two `Bash` PreToolUse entries whose command could never resolve, and a
 * fresh clone of THIS repository got neither them nor a tracked copy of the
 * registration (`settings.local.json` is gitignored). They are this repository's
 * own development hooks; the registration now lives in this repository's tracked
 * `.claude/settings.json`, where `${CLAUDE_PROJECT_DIR}` really is the root that
 * contains `src/`.
 *
 * Same mechanism and same reason as the write gate above: `mergeTemplateOwnedHooks`
 * preserves every on-disk entry the template does not declare, so REMOVING the
 * spread from `buildClaudeSettingsLocalJson` would leave the two unresolvable
 * entries in every install that already had them, forever.
 *
 * Deliberately narrow: it matches the exact command string 1.9.0 emitted — `bash`,
 * then the project-root variable, then that script's shipped path — under the
 * matcher 1.9.0 used, with a single handler. A consumer's own `Bash` entry (a
 * different command, or more than one handler) is preserved like any other entry
 * the template does not declare.
 */
const RETIRED_FEEDBACK_HOOK_MATCHER = 'Bash';
const RETIRED_FEEDBACK_HOOK_COMMANDS: ReadonlySet<string> = new Set(
  [
    'pre-tool-peaks-current-directory-scope.sh',
    'pre-tool-piping-a-test-run-reports-the-pipes-exit-code.sh'
  ].map((script) => `bash "\${CLAUDE_PROJECT_DIR}/src/services/hooks/${script}"`)
);

/**
 * Is `entry` one this template used to declare and has since RETIRED?
 *
 * Each retirement gets its own narrow predicate — the shapes share neither a
 * matcher nor a command form. An entry whose shape matches nothing here is not
 * retired, and is preserved.
 */
export function isRetiredTemplateEntry(entry: unknown): boolean {
  if (!isPreToolUseEntry(entry)) return false;
  if (entry.hooks.length !== 1) return false;
  const [handler] = entry.hooks;
  if (handler === undefined) return false;
  if (handler.type !== 'command') return false;
  if (entry.matcher === RETIRED_WRITE_GATE_MATCHER) {
    return RETIRED_WRITE_GATE_COMMAND.test(handler.command);
  }
  if (entry.matcher === RETIRED_FEEDBACK_HOOK_MATCHER) {
    return RETIRED_FEEDBACK_HOOK_COMMANDS.has(handler.command);
  }
  return false;
}
