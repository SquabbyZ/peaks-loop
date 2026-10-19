---
name: a-pretooluse-gate-that-prints-a-remedy-must-exempt-that-remedy-from-itself
description: a PreToolUse gate that prints a remedy must exempt that remedy from itself
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-19-session-94b084/txt/handoff.md
---

A gate installed on every Bash call blocks the very command it tells the caller to run. The gate
process only learns which command is being gated from the hook payload on stdin (`tool_input.command`);
`--prompt`, `last-prompt.txt` and environment variables cannot carry it. When adding such an exemption,
match an *invocation* (tokenise, require `peaks code detect-job` as the executable tokens) rather than a
substring, and keep shell separators, here-documents, quotes, backticks and `$(` closed — otherwise a
command that merely mentions the verb, or embeds a substitution, inherits the allow.

**Why:** without the exemption the workflow deadlocks exactly when it is blocked — the remedy is itself a
Bash call — and a substring match makes the exemption a bypass rather than a narrow door.

**How to apply:** when a PreToolUse gate's refusal text names a command, add the same command to the gate's
allow arm, read it from stdin, and add a red control for the quoted/compound form. Measured on
peaks-loop 4.1.8, Windows Claude Code: PowerShell forwards stdin to the native child, and the
`retry` path returns `mode: remedy-command` with exit 0.
