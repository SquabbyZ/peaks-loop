# Step 0 — Anchor the workflow

> Body of `### Peaks-Cli Step 0: Anchor the workflow`. The instant Peaks-Cli Solo is invoked, **before** the mode-selection question, before any analysis, and before you decide whether the request "needs" the full pipeline, you MUST run these two commands and see their output:

```bash
# Session ID is auto-generated when omitted; the command returns it in the JSON output.
# Do NOT pass --session-id manually — the CLI is the single source of truth for the
# project session binding. To look up the active session id from a skill / sub-agent,
# use `peaks session info --active --json` (read-only, no side effects). To avoid
# the "two sessions in .peaks/" confusion that bites Solo, always omit --session-id
# here and let the CLI auto-generate.
peaks workspace init --project <repo> --json
peaks skill presence:set peaks-solo --project <repo> --gate startup
```

> `<repo>` is the **git project root** (the directory containing `.git`). In a monorepo / single-repo-multi-package layout, this is the repo root, NOT a sub-package — `.peaks/` lives at the repo root so every package shares one workspace. If unsure, run `git rev-parse --show-toplevel` and use that path. Never let `.peaks/` land inside a sub-package directory.

**There is no request too lightweight to skip this.** "分析下这个项目", "看一下代码", "分析项目", "解释一下架构", a one-line question — all of them still create the workspace and set presence first. The workspace is cheap; a missing `.peaks/` is the #1 reported failure.

**Anti-bail-out rule (BLOCKING):** You MUST NOT exit the peaks-solo workflow, hand control back, or produce a final answer before Step 0 has run. If you catch yourself thinking "this is just analysis, I don't need the workflow" — STOP. Run Step 0, set presence, then continue. A pure-analysis request runs the **lightweight analysis branch** (project scan + standards dry-run + handoff with a Standards-increment section), but it still anchors the workspace and keeps presence active. Declining to anchor is a workflow violation.

**Session conflict resolution (read once, internalise):** If `peaks workspace init` returns `code: "CONFLICTING_SESSION"` with a body like
`{"existingSessionId":"<Y>","requestedSessionId":"<X>"}`, the project is already bound to a different in-flight session `<Y>` (the one you or a prior run was working on). The fix is **NOT** to pass `--allow-session-rebind` to clobber `<Y>` — that destroys an active session's data. Instead: finish or abandon `<Y>` first (use `peaks session list --json` to see what it is, then `peaks session finish --id <Y>` or `peaks session abandon --id <Y>` — see your session command's help for the exact verbs). Only after `<Y>` is closed should you re-run `peaks workspace init`. The same rule applies to `peaks workspace init --session-id "<manually-forged>"` — do not pre-forge session ids; the CLI's auto-generated value is the binding.

**Fact-Forcing Gate bypass (slice 2.0.1-bug3):** Claude Code's [Fact-Forcing Gate] fires in two shapes inside peaks-solo Step 0: (1) Bash-side "Quote the user's current instruction verbatim. Then retry the same operation." and (2) Write-side 4-facts prompt. Both block the very first Write to `.peaks/_runtime/<sid>/session.json` and the first `peaks skill presence:set peaks-solo` invocation. The default `peaks workspace init` (no flag) materializes `.claude/settings.local.json` in the consumer project root with a PreToolUse hook allow-list that exits 0 for tool calls inside `.peaks/**` and for `peaks <whitelisted-subcommand>` Bash commands. The hook bypasses the gate before it fires.

If the bypass is not in effect (e.g. `.claude/` was read-only, or the user passed `--no-claude-hooks`, or the consumer manually deleted the file), the recovery flow is:

1. Re-run `peaks workspace init --project <repo> --json` **without** `--no-claude-hooks`. The next-action list will say "Materialized .claude/settings.local.json (action: written/refreshed)". Restart Claude Code so the hook takes effect.
2. If `.claude/` cannot be written (read-only mount, container with no write access, etc.), drop the contents of `.peaks/.claude-settings-template.json` into `.claude/settings.local.json` manually. The peaks-cli init always writes the offline template copy (regardless of `--no-claude-hooks`) so the user has a known source-of-truth on disk. After copying, restart Claude Code.

**Anti-bail-out rule for the gate:** Do NOT skip Step 0 because the gate fired. The gate is a Claude Code core feature that peaks-cli cannot modify directly; peaks-cli can only sidestep it via the hook allow-list. If the gate still blocks Step 0 after the bypass is in effect, the user has a misconfigured `.claude/settings.json` upstream — surface that as a separate `AskUserQuestion` ("Your `.claude/settings.json` is overriding the local allow-list. May peaks-cli delete the local file and regenerate it?") rather than skipping Step 0.

`presence:set` accepts no `--mode` here on purpose — mode is unknown until Step 1. It is re-run with the selected mode in Step 2. Setting presence early guarantees the status header/line shows `peaks-solo` from the very first turn even if the user never reaches mode selection.

## Step 0.6 — Heal stale templates after a peaks-cli version bump

> Slice 2026-06-13-selfheal-claude-settings-template. Read when the envelope's `claudeSettings.offlineTemplate.action === 'refreshed'` OR when the user just bumped peaks-cli and you suspect the consumer project's templates are out of date.

**Why this step exists:** peaks-cli releases can change `buildClaudeSettingsLocalJson()` — the source-of-truth function for the consumer-project `.claude/settings.local.json` and the offline `.peaks/.claude-settings-template.json`. When that function changes (e.g. the `node -e "..."` wrapper added in commit `9551c52`), existing on-disk copies from previous peaks-cli releases become **stale** and can break Claude Code's [Fact-Forcing Gate] bypass. The drift-driven self-heal inside `initWorkspace` (added in this slice) catches the drift and refreshes both files automatically on the next init. This step is the **user-visible surfacing** of that heal.

**Three trigger paths bring the project to the current peaks-cli baseline:**

1. **Normal workflow (auto):** any `peaks-solo` invocation → Step 0 anchor → `peaks workspace init` → drift check → self-heal if needed. This is the default path; users typically do NOT need to do anything explicit.
2. **Manual init (idempotent):** `peaks workspace init --project <repo> --json` — same drift check, same self-heal. Safe to re-run any number of times.
3. **Post-upgrade escape hatch:** `peaks upgrade --apply-init --project <repo> --json` — slice 4 (this slice). For users who upgrade peaks-cli but do not invoke `peaks-solo` after the bump (e.g. they installed 2.0.5 today but their next `peaks-solo` session is next week). The flag triggers `initWorkspace` directly.

**NextActions surfaced after Step 0 when self-heal fires:**

- `claudeSettings.offlineTemplate.action === 'refreshed'` → nextAction: "Self-healed `.peaks/.claude-settings-template.json` (action: refreshed) — the offline recovery anchor now matches the current peaks-cli template."
- Same → warning nextAction: "⚠️ If you had manually edited `.peaks/.claude-settings-template.json`, those edits have been overwritten by the self-heal. Re-apply your custom matchers / commands on top of the freshly-written template, or open an issue if your customisation is a recurring need (the team may promote it to the canonical template)."
- `claudeSettings.offlineTemplate.action === 'written'` → nextAction: "Wrote `.peaks/.claude-settings-template.json` (action: written) — the offline recovery anchor is now in place for future manual recoveries."
- `claudeSettings.action === 'refreshed'` (consumer-project file) → nextAction: "Materialized `.claude/settings.local.json` (action: refreshed) — the [Fact-Forcing Gate] is bypassed for tool calls inside .peaks/\*\*. Restart Claude Code so the hooks take effect."
- `claudeSettings.action === 'already-current'` → silent (no nextAction) — the bypass is already in effect and matches the current release; do not spam the nextAction list on every init.

**When to surface `--apply-init` to the user (LLM-only guidance):**

- When the user just upgraded peaks-cli (e.g. they ran `npm i -g peaks-cli@latest` between sessions) AND the Step 0 init envelope shows `offlineTemplate.action === 'refreshed'`, do NOT prompt for `--apply-init` — the heal already happened.
- When the user reports a stuck [Fact-Forcing Gate] that survives Step 0 (i.e. `peaks workspace init` ran without throwing but `Bash` / `Write` calls still get blocked), surface `peaks upgrade --apply-init --project <repo>` as a manual fallback. The flag is idempotent — safe to re-run.
- When the user's project has NO `.peaks/_runtime/` at all (i.e. they never ran init), do NOT recommend `--apply-init` first; recommend `peaks workspace init` instead. `--apply-init` works on first-time projects too, but `init` is the canonical entry point and produces a richer envelope.

**Anti-bail-out rule:** do NOT silently swallow the warning nextAction about manual-edits-overwritten. If the user customised `.peaks/.claude-settings-template.json` and the self-heal wiped their changes, that is data loss from their perspective — surface it. The loud ⚠️ is a feature, not noise.