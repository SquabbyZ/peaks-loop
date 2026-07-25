# Change: fix-claude-settings-template-hook-node-wrapper

## Why

> **Note on §Why revision (2026-07-24, reconciliation against HEAD = `e51797c3`):**
> The original §Why was authored before the v3.1.2 Bash gate-step-08 refactor (commit `d9a1a098`, 2026-07-04) and the `wrapAsNodeOneLiner` consolidation (commit `8411fe88`, 2026-06-13). It described a `Bash` matcher + `buildBashHookCommand()` shape that pre-dates the current code. The symptom and root cause are still load-bearing — bare JS source reaching bash, `syntax error near unexpected token` short-circuiting the hook — but the present-day code shape is different:
>
> - The Write|Edit|MultiEdit matcher command is produced by `buildWriteHookCommand()` (lines 196-209 of `src/services/workspace/claude-settings-template.ts`) and is wrapped in `node -e "<js>"` via the single-source-of-truth helper `wrapAsNodeOneLiner(js)` (lines 170-180).
> - The Bash matcher command is produced by `buildBashGateStep08Command()` (lines 271-278) and is **intentionally NOT wrapped** in `node -e "..."` — it returns the literal `peaks code gate-step-08 --project "${CLAUDE_PROJECT_DIR}"` string. CLI delegation is the load-bearing contract: the CLI is the only legitimate source of the structured decision + `Next:` line, and exit code is the gate-step-08 signal (0 = allow, 2 = block).
> - There is **no** `buildBashHookCommand()` function in the current codebase. The Bash matcher historically existed (TEMPLATE_VERSION 1.0.0 → 1.1.0); it was kept through 1.2.0, then **replaced** by `buildBashGateStep08Command()` in v3.1.2 (TEMPLATE_VERSION 1.3.0). This proposal predates that replacement and references the old name.
> - The docstring argv drift called out below (`argv[2]` vs `argv[1]`) is **already reconciled on HEAD**: the docstring on `buildWriteHookCommand` standardizes on `process.argv[1]` (line 200-201), consistent with Node.js argv layout under `-e` (cross-platform consistent per node docs).
>
> The preserved §Why below describes the **historical** shape (2.0.3 + pre-v3.1.2) and the load-bearing symptom; the items in **What Changes** below have been re-targeted to the actual code (replace `buildBashHookCommand` references with the two real builders + the no-wrapper rationale for `buildBashGateStep08Command`).

`peaks workspace init` (2.0.3) writes `.claude/settings.local.json` with PreToolUse `Bash` and `Write|Edit|MultiEdit` hook whose `command` field was **bare Node.js source code** rather than a `node -e "..."` one-liner. The accompanying docstring in `src/services/workspace/claude-settings-template.ts` described the command as a `node -e one-liner` and referenced `process.argv[2]`, but the implementation returned only the inner JS source and used `process.argv[1]`. Claude Code executed hook `command` fields as shell strings, so the literal JS source reached bash, which tripped a `syntax error near unexpected token` and short-circuited the hook with a non-zero exit code.

Net effect on every 2.0.3 install on Windows + macOS + Linux:

- Every Bash tool call (peaks CLI or otherwise) was rejected by the broken hook.
- Every Write / Edit / MultiEdit call was rejected by the broken hook.
- The [Fact-Forcing Gate] bypass that `peaks workspace init` is supposed to install was therefore self-defeating — the bypass broke the gate itself, and the gate could not be reached to fix it.

Recovery required the user to either delete `.claude/settings.local.json` manually (losing the bypass permanently) or hand-patch the `command` field (drift vs the template). This blocked any peaks-code Step 0 / Step 2 / RD / QA flow on a clean install.

## What Changes

- Wrap the `Write|Edit|MultiEdit` matcher command returned by `buildWriteHookCommand()` in `node -e "..."` via the single-source-of-truth helper `wrapAsNodeOneLiner(js)`, with all embedded double quotes JSON-escaped as `\\"`, so the on-disk `command` is a real shell-evaluable `node -e` one-liner. **Already implemented** (commit `8411fe88`, 2026-06-13).
- Leave the `Bash` matcher command returned by `buildBashGateStep08Command()` **unwrapped**. The CLI delegation (`peaks code gate-step-08 --project "${CLAUDE_PROJECT_DIR}"`) is the load-bearing contract — the CLI is the only legitimate source of the structured decision + `Next:` slice context, and exit code is the gate-step-08 signal (0 = allow, 2 = block). Wrapping the Bash matcher in `node -e "..."` would short-circuit the CLI delegation and break the v3.1.2 mechanical gate. **Already implemented** (commit `d9a1a098`, 2026-07-04, `TEMPLATE_VERSION 1.3.0`).
- Reconcile the docstring with the implementation: pick `process.argv[1]` (the actual candidate string passed by Claude Code) as the canonical index in the docstring and drop the misleading `argv[2]` reference. **Already implemented** on HEAD (`buildWriteHookCommand` docstring, line 200-201).
- Emit the wrapped Write/Edit/MultiEdit command through `buildClaudeSettingsLocalJson()` unchanged from the consumer's perspective — the wrapper is a builder-internal concern routed through `wrapAsNodeOneLiner`.
- Add cross-platform dogfood evidence: the wrapped Write/Edit/MultiEdit command must round-trip on Windows + macOS + Linux, each producing a Node child process that exits 0 for allow-list matches and 1 otherwise. The Bash gate-step-08 hook must also round-trip on each OS, with the same allow/deny semantics (0 = allow, 2 = block for non-peaks Bash calls).
- Update this proposal's references from `buildBashHookCommand()` to the actual builders (`buildWriteHookCommand()` wrapped; `buildBashGateStep08Command()` CLI-delegated, NOT wrapped) so future readers can locate the implementation.

## Out of Scope

- Refactoring the allow-list into a separate JSON or YAML file.
- Changing the allow-list contents (`workspace`, `skill`, `request`, `session`, `scan`, `sub-agent`, `gate`, `standards`, `hooks`, `statusline`, `memory`, `openspec`, `workflow`, `doctor`, `upgrade`).
- Changing the Write / Edit matcher to allow additional `.peaks/` segments beyond the current set.
- Rewriting the hook as an external `.js` file plus `command: node <path>` (deferred — see Risks).
- Updating pre-2.0.3 installs. This change targets `main` and ships as 2.0.4.

## Dependencies

- None. The fix is local to `src/services/workspace/claude-settings-template.ts` and its unit-test fixture.
- Existing `tests/unit/workspace/claude-settings-template.test.ts` (if present) must be updated to assert the wrapped form.

## Risks

- **JSON / shell double-escape mistake.** Wrapping inner JS in `node -e "..."` requires JSON-escaping every embedded double quote as `\\"`. A single missing escape breaks the wrapper on every platform simultaneously. Mitigation: a unit test that round-trips the command through `JSON.stringify(buildClaudeSettingsLocalJson())` and asserts the resulting string is a parseable shell command on all three target OSes.
- **Argv index drift.** The implementation reads `process.argv[1]`. The docstring previously said `argv[2]`. The docstring was reconciled to `argv[1]` in commit `8411fe88`, but the underlying risk remains: Claude Code may invoke hooks with different argv layouts in future versions, which would silently break the Write/Edit/MultiEdit matcher. Mitigation: a single-source-of-truth helper `wrapAsNodeOneLiner(js)` plus the builder-internal `process.argv[1]` read, and a unit test asserting the helper picks the argv slot that contains the candidate. If Claude Code changes the argv contract, only the inner JS read inside `buildWriteHookCommand` changes.
- **External `.js` file path divergence.** The simpler alternative — write a real `.js` file and reference it via `command: node <absolute-path>` — was rejected because absolute paths differ across machines and Windows path separators (`\` vs `/`) add another escape layer. Deferred until evidence shows `node -e` is insufficient.
- **`node` not on PATH.** The hook assumes `node` is resolvable on the user's PATH. Documented in peaks-loop README; out of scope for this change.

## Acceptance Criteria

- `buildWriteHookCommand()` returns a string that begins with `node -e "` and ends with `"`, with embedded `"` characters escaped as `\\"`.
- `buildBashGateStep08Command()` returns the literal `peaks code gate-step-08 --project "${CLAUDE_PROJECT_DIR}"` string — **NOT** wrapped in `node -e "..."`. Wrapping would break the v3.1.2 mechanical gate because the CLI delegation is the load-bearing contract.
- `buildClaudeSettingsLocalJson()` round-trips through `JSON.stringify` without throwing and produces a string that, when written to `.claude/settings.local.json` and executed by Claude Code's hook runner on Windows, macOS, and Linux:
  - For the Write|Edit|MultiEdit matcher: exits 0 for paths containing `.peaks/_runtime/` and exits 1 otherwise.
  - For the Bash matcher: delegates to `peaks code gate-step-08`, exits 0 for allow-listed peaks Bash calls, exits 2 (or non-zero) with a BLOCKED reason on stderr for non-peaks Bash calls (e.g. `npm install foo`).
- New unit tests cover: the wrapper prefix on `buildWriteHookCommand`, the JSON-escape contract, the argv[1] index selection, the no-wrapper assertion on `buildBashGateStep08Command`, and the round-trip property above.
- Existing unit tests that asserted the old unwrapped form are updated to the wrapped form and still pass.
- `pnpm test`, `pnpm typecheck`, and `pnpm test:coverage` pass with the existing coverage floor for the changed module.
- A dogfood run on the current repo (Windows + macOS runners, or local equivalents) shows `peaks workspace init --no-claude-hooks` followed by `peaks workspace init --force-hooks` produces a `.claude/settings.local.json` whose `command` field round-trips through `node -e` (Write/Edit/MultiEdit matcher) and through the CLI (Bash matcher) without syntax error.