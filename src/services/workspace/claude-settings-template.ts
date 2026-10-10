/**
 * Slice 2.0.1-bug3-fact-forcing-bypass — pure-data template for the
 * consumer-project `.claude/settings.local.json` file.
 *
 * The template exempts the peaks-managed `.peaks/` workspace from the
 * Claude Code [Fact-Forcing Gate], so `peaks workspace init` (Step 0 of
 * every peaks-code session) is runnable in a consumer project — without
 * the exemption the gate blocks the very first Write.
 *
 * The exemption is declared in the `env` block
 * (`EXTERNAL_GATE_EXEMPT_ENV`), which is what the gate actually reads.
 * TEMPLATE_VERSION 1.7.0 moved it there; before that it was declared by a
 * `Write|Edit|MultiEdit` handler that exited non-zero for non-`.peaks/`
 * paths and was documented as "fall through to the gate". That concept does
 * not exist in the Claude Code hook protocol (only exit 2 blocks; any other
 * non-zero exit is a NON-BLOCKING ERROR reported once per edit), so the
 * handler was corrected to abstain on every path — and an abstaining handler
 * that is still INSTALLED is a no-op carrying a machine-specific absolute
 * script path. TEMPLATE_VERSION 1.8.0 removed it rather than re-point it:
 * it decided nothing, and the exemption it was written for lives in `env`.
 *
 * The template is a pure-data function (no filesystem, no clock) so
 * it can be unit-tested in isolation and so the on-disk file matches
 * the in-memory template byte-for-byte.
 *
 * Four `Bash` matchers are emitted: the Step 0.8 mechanical gate, the SOP
 * gate-enforce handler, and the two layer-B feedback hooks. No
 * `Write|Edit|MultiEdit` entry is emitted: that matcher's gate is
 * `peaks code-gate --json`, installed into the committed
 * `.claude/settings.json` by `peaks hooks install`.
 *
 * The previous `Bash` matcher (which whitelisted a fixed `peaks
 * <subcommand>` prefix) was removed in TEMPLATE_VERSION 1.2.0. The
 * [Fact-Forcing Gate] is an Edit/Write concern (it forces the LLM
 * to quote user instructions before any file write), and the Bash
 * matcher was emitting `process.exit(1)` with no stderr on every
 * non-peaks Bash call — a non-blocking "No stderr output" noise
 * decoration in the Claude Code UI even though the underlying tool
 * call still proceeded. Bash command enforcement is now owned by
 * `peaks gate enforce`, which `peaks hooks install` injects into the
 * consumer project's `.claude/settings.json` and which exits 0
 * silently for any command not guarded by a registered SOP gate.
 */

import {
  EXTERNAL_GATE_EXEMPT_ENV,
  resolveHookShell,
  resolveHookSpec
} from '../skills/hooks-codegate-superpowers.js';

/**
 * The comparison and the entry-level merge live in
 * `claude-settings-template-merge.ts` — they were two thirds of this file's
 * bytes and none of its template shape. Re-exported here so this module stays
 * the single public entry point for the template concern: no caller has to
 * know which half a symbol lives in.
 */
export {
  isRetiredTemplateEntry,
  mergeTemplateOwnedHooks,
  templateContentMatches
} from './claude-settings-template-merge.js';

export const CLAUDE_SETTINGS_LOCAL_FILENAME = '.claude/settings.local.json';

/**
 * Informational version of the offline template shape. Bumped when the
 * template's hooks tree (matchers, allow-list content, wrapper format)
 * changes in a way that should trigger a refresh of stale on-disk
 * copies. The comparator (`templateContentMatches`) is the source of
 * truth for refresh decisions — this constant exists so a developer
 * reading the diff can correlate a template change with a deliberate
 * bump. Future work may write a version-marker file to short-circuit
 * the comparator; for now the constant is informational only.
 *
 * History:
 *   1.0.0 — initial template with `Write|Edit|MultiEdit` and `Bash`
 *           matchers (slice 2.0.1-bug3-fact-forcing-bypass)
 *   1.1.0 — added `node -e "..."` wrapper contract
 *           (slice fix-claude-settings-template-hook-node-wrapper)
 *   1.2.0 — removed the `Bash` matcher; Edit/Write fact-forcing
 *           bypass is the only emit. Bash enforcement is owned by
 *           `peaks gate enforce` in `settings.json`.
 *   1.3.0 — added the v3.1.2 `Bash` PreToolUse matcher that runs
 *           `peaks code gate-step-08 --project .` (Step 0.8 mechanical
 *           gate). The existing Write|Edit|MultiEdit matcher is
 *           preserved. The new matcher's exit code is the load-bearing
 *           signal: 0 = allow, 2 = block (with stderr BLOCKED reason).
 *   1.4.0 — added the `peaks gate enforce` `Bash` PreToolUse entry. It
 *           lives here (machine-local, gitignored file) rather than in
 *           the committed `.claude/settings.json` because its `shell`
 *           is machine-specific: on Windows the default Git-Bash shell
 *           force-allocates a console window on every Bash tool call.
 *           This template is the second writer of that file, so it must
 *           emit the entry too — otherwise `peaks workspace init` would
 *           overwrite whatever `peaks hooks install` put there.
 *   1.5.0 — pinned the same platform `shell` on the `peaks code
 *           gate-step-08` handler. It runs on the same `Bash` matcher,
 *           so leaving it un-pinned left the console-window defect in
 *           place for half of every Bash tool call.
 *   1.6.0 — the `Write|Edit|MultiEdit` handler no longer inlines its
 *           JavaScript as `node -e "<js>"`. It invokes the shipped script
 *           string carries no shell-escaped payload at all and the handler
 *           can take the same platform `shell` pin as its siblings. The
 *           decision itself is a verbatim relocation — see that file.
 *   1.7.0 — added the `env` block declaring Peaks' workspace tree exempt
 *           from a THIRD-PARTY PreToolUse fact-forcing gate
 *           (`EXTERNAL_GATE_EXEMPT_ENV`). The comparator now requires the
 *           on-disk file to declare those exemptions too, so a project
 *           installed by an earlier release refreshes once and converges.
 *   1.8.0 — REMOVED the `Write|Edit|MultiEdit` handler and the shipped
 *           deleted). The handler abstained on every path by design (see
 *           that file's header for the rationale — it is the reason this
 *           is a deletion and not a repair), so the only things it still
 *           contributed were a `node "<abs path>"` command pinned to the
 *           Node version directory that happened to be on `$PATH` at
 *           install time, and a `shell: powershell` pin. The exemption it
 *           was written to provide is declared by the `env` block above.
 *           `mergeTemplateOwnedHooks` drops the retired entry from
 *           existing on-disk files, so an earlier install converges
 *           instead of keeping a no-op with a stale absolute path.
 *   1.9.0 — added the two layer-B feedback hook entries
 *           (`pre-tool-peaks-current-directory-scope.sh` and
 *           `pre-tool-piping-a-test-run-reports-the-pipes-exit-code.sh`),
 *           pinned to `shell: bash`. Until now their registration existed only
 *           in the generated copies on the machine that hand-wrote them: a
 *           fresh clone got the two scripts and no registration, so the
 *           promotion they carry was true only locally. See
 *           `buildFeedbackHookHandler` for why the pin is `bash` and not the
 *           `powershell` its three siblings take.
 */
export const TEMPLATE_VERSION = '1.9.0';

/**
 * TEMPLATE_VERSION 1.4.0 — the SOP gate-enforce handler, read from the same
 * canonical hook spec `peaks hooks install` uses. Deriving it here (rather
 * than re-typing the literal) is what keeps the two writers of this file
 * byte-compatible: `templateContentMatches` compares the `command` string,
 * so any drift would make every `peaks workspace init` rewrite the file and
 * drop whatever `peaks hooks install` had merged in.
 */
function buildGateEnforceHandler(): ClaudeHookCommand {
  const spec = resolveHookSpec('claude-code');
  return {
    type: 'command',
    command: spec.hookEnforceCommand,
    ...(spec.hookEnforceShell !== undefined ? { shell: spec.hookEnforceShell } : {})
  };
}

type ClaudeHookCommand = { type: 'command'; command: string; shell?: string };
type ClaudePreToolUseEntry = { matcher: string; hooks: ClaudeHookCommand[] };
type ClaudeSettingsLocal = {
  hooks: { PreToolUse: ClaudePreToolUseEntry[] };
  /**
   * Exemptions declared to the third-party PreToolUse gate peaks does not own
   * (`EXTERNAL_GATE_EXEMPT_ENV`). They belong in THIS file because it is
   * machine-local and gitignored: a third-party variable name in the committed
   * shared `settings.json` would be pushed to every consumer of the project.
   */
  env: Record<string, string>;
};

/**
 * Build the full template object. The shape is the subset of Claude
 * Code's `.claude/settings.local.json` schema that PreToolUse hooks
 * need — we do not emit the `permissions` block because the fact-
 * forcing gate is a core feature that PreToolUse hooks can short-
 * circuit but that the `permissions` block cannot.
 *
 * As of TEMPLATE_VERSION 1.9.0 the template emits four `Bash` matchers: the
 * two above, plus one per layer-B feedback hook (`FEEDBACK_HOOK_SCRIPTS`). The
 * `Write|Edit|MultiEdit` fact-forcing bypass is no longer a hook: it is the
 * `env` exemption above, and that matcher's gate (`peaks code-gate --json`) is
 * installed into the committed `.claude/settings.json` by `peaks hooks
 * install`.
 */
export function buildClaudeSettingsLocalJson(): ClaudeSettingsLocal {
  return {
    // Slice emit-gateguard-exemption — the third-party gate exemption. This is
    // now the ONLY mechanism carrying the `.peaks/**` bypass (TEMPLATE_VERSION
    // 1.8.0 removed the abstaining `Write|Edit|MultiEdit` handler that used to
    // be described here). `peaks hooks install` merges the same row into this
    // file, so the two writers agree.
    env: { ...EXTERNAL_GATE_EXEMPT_ENV },
    hooks: {
      PreToolUse: [
        {
          // v3.1.2 Step 0.8 — Mechanical PreToolUse gate. Runs
          // `peaks code gate-step-08 --project .` before every Bash
          // tool call. Exit 0 = allow (with structured stdout
          // describing the decision + optional `Next: slice #N+1 of
          // M (<currentSlice>)` line when progress.json exists). Exit
          // 2 = block (stderr contains the BLOCKED: ... reason).
          matcher: 'Bash',
          hooks: [buildBashGateStep08Handler()]
        },
        {
          // TEMPLATE_VERSION 1.4.0 — SOP gate enforcement. Lives in this
          // machine-local file (not the committed settings.json) because
          // `shell` is machine-specific; see the version history above and
          // `resolveHookShell`.
          //
          // It sits in its own matcher group on purpose: a group counts as
          // peaks-managed only when EVERY handler in it carries a peaks
          // sentinel, and the `peaks code gate-step-08` handler above does
          // not. Sharing a group with it would make the whole group
          // unmanaged, so `peaks hooks install` would append a second Bash
          // group and the gate would run twice per Bash call.
          matcher: 'Bash',
          hooks: [buildGateEnforceHandler()]
        },
        ...FEEDBACK_HOOK_SCRIPTS.map((script) => ({
          // TEMPLATE_VERSION 1.9.0 — the layer-B feedback hooks, one matcher
          // group each, for the same reason the entry above has its own: a
          // group is peaks-managed only when EVERY handler in it carries a
          // peaks sentinel, and none of these handlers does.
          matcher: 'Bash',
          hooks: [buildFeedbackHookHandler(script)]
        }))
      ]
    }
  };
}

/**
 * v3.1.2: build the Bash matcher command that runs `peaks code
 * gate-step-08`. We invoke the CLI directly (not via `node -e "..."`)
 * because the CLI is the only legitimate source of the structured
 * decision + Next: slice context. Exit code is the load-bearing
 * signal — 0 = allow, 2 = block. The hook installer is idempotent:
 * `templateContentMatches` compares the parsed matcher entries, so
 * re-running `peaks workspace init` on a project that already has the
 * Bash hook is a no-op (already-current).
 */
function buildBashGateStep08Handler(): ClaudeHookCommand {
  // The hook receives the tool call on stdin. We ignore stdin and
  // delegate entirely to `peaks code gate-step-08`, which reads
  // .peaks/_runtime/<sessionId>/job-shape.json and last-prompt.txt.
  // `${CLAUDE_PROJECT_DIR}` resolves to the consumer project's root
  // (Claude Code's standard convention).
  //
  // TEMPLATE_VERSION 1.5.0 — shell-pinned on Windows for the same reason
  // as the gate-enforce handler below: this runs on the same `Bash`
  // matcher, so a shell-form command is executed by Git Bash / MSYS2,
  // which force-allocates a console window on every Bash tool call.
  const shell = resolveHookShell();
  return {
    type: 'command',
    command: 'peaks code gate-step-08 --project "${CLAUDE_PROJECT_DIR}"',
    ...(shell !== undefined ? { shell } : {})
  };
}

/**
 * TEMPLATE_VERSION 1.9.0 — the two rules promoted to layer B by hand first: the
 * scripts shipped in `src/services/hooks/`, but the registration existed only in
 * the generated copy on the machine that wrote it. Emitting it here is what makes
 * the promotion a property of the repository rather than of that machine — the
 * layer-B feedback gate reads THIS template's `hooks` block, so a fresh clone had
 * the enforcement and nothing registering it.
 *
 * The filenames are the contract: the layer-B check looks for a hook command that
 * INVOKES A FILE NAMED AFTER THE RULE, so the command has to carry the script's
 * name and cannot be a `peaks` verb that dispatches to it.
 */
const FEEDBACK_HOOK_SCRIPTS = [
  'pre-tool-peaks-current-directory-scope.sh',
  'pre-tool-piping-a-test-run-reports-the-pipes-exit-code.sh'
] as const;

/** The shell these two handlers are pinned to. See `buildFeedbackHookHandler`. */
const FEEDBACK_HOOK_SHELL = 'bash';

/**
 * The handler for one feedback hook, pinned to `shell: 'bash'`.
 *
 * THE PIN IS THE DECISION, and it is deliberately not the `powershell` its three
 * siblings take. Measured on this host, both shapes run the script and both print
 * its refusal to stderr — but they do not report the same exit code:
 *
 *   bash       "<script>"                       exit 2   (the script's own code)
 *   powershell "<script>"                       exit 1   (flattened by the shell)
 *
 * Under the Claude Code hook protocol only exit 2 blocks; any other non-zero exit
 * is a NON-BLOCKING ERROR and the tool call goes ahead. So pinning `powershell`
 * here would not be a cosmetic difference on a blocking hook — it would turn the
 * refusal into a log line and let the command through, which is the failure these
 * two entries exist to prevent. `shell` accepts `bash` and `powershell` only, and
 * `bash` is also the interpreter this command already names.
 */
function buildFeedbackHookHandler(script: string): ClaudeHookCommand {
  return {
    type: 'command',
    command: `bash "\${CLAUDE_PROJECT_DIR}/src/services/hooks/${script}"`,
    shell: FEEDBACK_HOOK_SHELL
  };
}
