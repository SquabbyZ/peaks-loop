# Spec Delta: claude-settings

## ADDED Requirements

### Requirement: Hook command is a Node one-liner

The PreToolUse hook `command` field produced by `buildClaudeSettingsLocalJson()` SHALL be a shell-evaluable `node -e "<js>"` string. The inner JS SHALL be JSON-escaped (every embedded `"` escaped as `\\"`) so the wrapper opens and closes at the correct positions when Claude Code passes the string to a shell.

#### Scenario: Bash (gate-step-08) matcher delegates to the CLI — NOT wrapped

- **GIVEN** a call to `buildBashGateStep08Command()` (the v3.1.2 Step 0.8 mechanical gate)
- **WHEN** the result is read
- **THEN** the string is the literal `peaks code gate-step-08 --project "${CLAUDE_PROJECT_DIR}"` invocation
- **AND** the string does NOT start with `node -e "` — the Bash matcher is intentionally unwrapped because CLI delegation is the load-bearing contract
- **AND** wrapping the Bash matcher in `node -e "..."` would short-circuit the CLI delegation and break the v3.1.2 mechanical gate (the CLI is the only legitimate source of the structured decision + `Next:` slice context; exit code is the gate-step-08 signal: 0 = allow, 2 = block)

#### Scenario: Write matcher has the wrapper

- **GIVEN** a call to `buildWriteHookCommand()`
- **WHEN** the result is read
- **THEN** the string starts with `node -e "`
- **AND** the string ends with `"`

#### Scenario: Round-trip through JSON.stringify is parseable

- **GIVEN** `buildClaudeSettingsLocalJson()` returns a template object
- **WHEN** `JSON.stringify(template)` is called and the `hooks.PreToolUse[*].hooks[*].command` field is extracted
- **THEN** for the Write|Edit|MultiEdit matcher the extracted string is a valid shell command that, when executed via `sh -c` (or platform equivalent), launches a Node process that exits 0 for paths containing `.peaks/_runtime/` and exits 1 for non-matching paths
- **AND** for the Bash matcher the extracted string is the literal `peaks code gate-step-08 --project "${CLAUDE_PROJECT_DIR}"` invocation, which when executed via `sh -c` launches the CLI; the CLI exits 0 for allow-listed peaks Bash calls and exits 2 with `BLOCKED:` reason on stderr for non-peaks Bash calls (e.g. `npm install foo`)

### Requirement: Hook command works on Windows, macOS, and Linux

The wrapped command SHALL exit 0 / exit 1 as documented when executed by Claude Code's hook runner on Windows 10+, macOS 12+, and a current Ubuntu LTS release. The wrapper SHALL NOT depend on platform-specific shell features (no bash-isms, no PowerShell-isms).

#### Scenario: Windows Git Bash

- **GIVEN** the wrapped command written to `.claude/settings.local.json` on a Windows machine with Git Bash
- **WHEN** Claude Code invokes the hook with a Bash tool call candidate of `peaks workspace init --project . --json`
- **THEN** the hook process exits 0

#### Scenario: macOS bash

- **GIVEN** the wrapped command on a macOS machine with default zsh / bash
- **WHEN** Claude Code invokes the hook with the same Bash candidate
- **THEN** the hook process exits 0

#### Scenario: Linux bash

- **GIVEN** the wrapped command on a Linux runner
- **WHEN** Claude Code invokes the hook with the same Bash candidate
- **THEN** the hook process exits 0

#### Scenario: Non-peaks command is denied

- **GIVEN** any of the three platforms above
- **WHEN** Claude Code invokes the Bash hook with candidate `npm install foo`
- **THEN** the hook process exits non-zero

### Requirement: argv index is single-sourced

The inner JS payload SHALL read the candidate command string from a single `process.argv` slot, and that slot SHALL be the one Claude Code actually passes. The docstring in `claude-settings-template.ts` SHALL match the implementation. There SHALL be a unit test that pins the argv slot so any future drift is caught at test time.

#### Scenario: Docstring matches implementation

- **GIVEN** `claude-settings-template.ts` is read
- **WHEN** a reviewer reads the docstring on `buildWriteHookCommand` (and notes that `buildBashGateStep08Command` has no argv reference because it does not run inner JS)
- **THEN** the `process.argv[N]` reference on `buildWriteHookCommand` matches the slot the inner JS actually reads (currently `argv[1]`)

#### Scenario: Argv helper is unit-tested

- **GIVEN** the inner JS payload extracted from the wrapped command
- **WHEN** the payload is executed in a Node child process with `process.argv` populated as Claude Code would populate it
- **THEN** the payload reads the candidate string and exits 0 / 1 as documented