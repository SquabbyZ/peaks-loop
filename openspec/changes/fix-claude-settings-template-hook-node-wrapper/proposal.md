# Change: fix-claude-settings-template-hook-node-wrapper

## Why

`peaks workspace init` (2.0.3) writes `.claude/settings.local.json` with a PreToolUse `Bash` and `Write|Edit|MultiEdit` hook whose `command` field is **bare Node.js source code** rather than a `node -e "..."` one-liner. The accompanying docstring in `src/services/workspace/claude-settings-template.ts` describes the command as a `node -e one-liner` and references `process.argv[2]`, but the implementation returns only the inner JS source and uses `process.argv[1]`. Claude Code executes hook `command` fields as shell strings, so the literal JS source reaches bash, which trips a `syntax error near unexpected token` and short-circuits the hook with a non-zero exit code.

Net effect on every 2.0.3 install on Windows + macOS + Linux:

- Every Bash tool call (peaks CLI or otherwise) is rejected by the broken hook.
- Every Write / Edit / MultiEdit call is rejected by the broken hook.
- The [Fact-Forcing Gate] bypass that `peaks workspace init` is supposed to install is therefore self-defeating — the bypass breaks the gate itself, and the gate cannot be reached to fix it.

Recovery requires the user to either delete `.claude/settings.local.json` manually (losing the bypass permanently) or hand-patch the `command` field (drift vs the template). This blocks any peaks-solo Step 0 / Step 2 / RD / QA flow on a clean install.

## What Changes

- Wrap the `Bash` matcher command returned by `buildBashHookCommand()` in `node -e "..."`, with all embedded double quotes JSON-escaped, so the on-disk `command` is a real shell-evaluable `node -e` one-liner.
- Wrap the `Write|Edit|MultiEdit` matcher command returned by `buildWriteHookCommand()` in `node -e "..."` with the same JSON-escape contract.
- Reconcile the docstring with the implementation: pick `process.argv[1]` (the actual candidate string passed by Claude Code) as the canonical index in the docstring and drop the misleading `argv[2]` reference.
- Emit the wrapped commands through `buildClaudeSettingsLocalJson()` unchanged from the consumer's perspective — the wrapper is a builder-internal concern.
- Add cross-platform dogfood evidence: the wrapped command must round-trip on Windows + macOS + Linux, each producing a Node child process that exits 0 for allow-list matches and 1 otherwise.

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
- **Argv index drift.** The current code reads `process.argv[1]`. The docstring previously said `argv[2]`. Claude Code may invoke hooks with different argv layouts in future versions, which would silently break the matcher. Mitigation: a single-source-of-truth helper that reads the candidate string and a unit test asserting the helper picks the argv slot that contains the candidate. If Claude Code changes the argv contract, only the helper changes.
- **External `.js` file path divergence.** The simpler alternative — write a real `.js` file and reference it via `command: node <absolute-path>` — was rejected because absolute paths differ across machines and Windows path separators (`\` vs `/`) add another escape layer. Deferred until evidence shows `node -e` is insufficient.
- **`node` not on PATH.** The hook assumes `node` is resolvable on the user's PATH. Documented in peaks-cli README; out of scope for this change.

## Acceptance Criteria

- `buildBashHookCommand()` returns a string that begins with `node -e "` and ends with `"`, with embedded `"` characters escaped as `\\"`.
- `buildWriteHookCommand()` returns a string with the same shape.
- `buildClaudeSettingsLocalJson()` round-trips through `JSON.stringify` without throwing and produces a string that, when written to `.claude/settings.local.json` and executed by Claude Code's hook runner on Windows, macOS, and Linux, exits 0 for `peaks workspace init --project . --json` and exits 1 for `npm install foo`.
- New unit tests cover: the wrapper prefix, the JSON-escape contract, argv index selection, and the round-trip property above.
- Existing unit tests that asserted the old unwrapped form are updated to the wrapped form and still pass.
- `pnpm test`, `pnpm typecheck`, and `pnpm test:coverage` pass with the existing coverage floor for the changed module.
- A dogfood run on the current repo (Windows + macOS runners, or local equivalents) shows `peaks workspace init --no-claude-hooks` followed by `peaks workspace init --force-hooks` produces a `.claude/settings.local.json` whose `command` field round-trips through `node -e` without syntax error.