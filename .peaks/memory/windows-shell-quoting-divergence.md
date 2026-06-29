---
name: windows-shell-quoting-divergence
description: On Windows, Git Bash (MSYS) and PowerShell have different command-line escaping for " inside start "..."; tests should use the hook-path command (Node spawn) instead of bash-side cmd invocations
metadata:
  type: feedback
---
<!-- peaks-feedback-promoted: layer=A -->

On Windows, when testing `cmd //c "start \"title\" command"` or similar nested-quote patterns, the test outcome depends on which shell interprets the outer command:
- **Git Bash (MSYS)** — applies MSYS path-conversion and quoting rules; `\\\"` becomes `\"`; MSYS may strip or convert quotes; a test that works in Git Bash can fail differently than the same command from PowerShell or from Node's `child_process.spawn`.
- **PowerShell** — has its own escaping (`""` for embedded quote, `` ` `` for escape); less surprising but still different from Node spawn.
- **Node `child_process.spawn`** — applies libuv's Windows-specific `quote()` function (`child_process.js`); backslash-doubling, quote-escaping per the rules in https://docs.microsoft.com/en-us/cpp/cpp/main-function-command-line-args.

The user's test via `cmd //c` from Git Bash surfaced a different error (file-association dialog) than the hook-path Node spawn (the actual "sub-agent not found" bug). Both were "errors" but with different root causes; only the Node-spawn path was the user's real one.

**Why:** Per user feedback during slice `2026-06-06-sub-agent-spawn-bug-and-decouple`: "windows系统也可以尝试先使用git bash没有再使用poiwershell" (when testing on Windows, try Git Bash first, then PowerShell). The intent is to use the shell whose escaping matches Node spawn, so the test result matches the hook's actual runtime behavior. Empirically on this user's machine, Git Bash diverged from PowerShell/Node spawn in unhelpfully noisy ways.

**How to apply:**
- When writing a Windows-side dogfood that exercises a Node-spawned subprocess, prefer running the EXACT hook command via `peaks ...` from a Bash tool. The Bash tool's shell choice is up to the test author; pick the one whose escaping best matches the actual runtime.
- If the test must use a hand-constructed `cmd //c "..."` to inspect the actual command line, do it in a BASH tool that uses Git Bash quoting, document the chosen shell, and validate the test passes identically when the same command is run via `child_process.spawn` from a minimal Node script.
- When reviewing QA evidence for Windows-side fixes, always cross-check: did the test exercise the same spawn path as the production hook? If not, the test is a smoke test and may miss the real bug.
- For the `peaks progress start` hook specifically, the production path is `child_process.spawn('cmd', ['/c', 'start', title, 'cmd', '/k', bannerCmd], {detached: true})` — tests that mimic this arg shape (regardless of shell) are valid; tests that use `cmd /c "start \"title\" cmd /k ..."` may diverge due to shell escaping.

**Cross-references:**
- `[[real-cmdline-regression-test-for-spawn]]` — companion memory on constructing the real cmdline for assertions
- `[[windows-test-baseline-30-fail]]` — the 30-fail baseline is all `EPERM: symlink` issues that show up in any shell; not related to this divergence
- slice evidence: `.peaks/_runtime/2026-06-06-session-5b1095/qa/test-reports/2026-06-06-sub-agent-spawn-bug-and-decouple.md`
