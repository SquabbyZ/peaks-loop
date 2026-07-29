@echo off
REM Slice 2026-07-29-windows-console-flash Part 45.
REM
REM Wrapper for the peaks gate enforce PreToolUse hook. Replaces
REM the direct 'peaks gate enforce' command in
REM .claude/settings.json so the hook does not flash a
REM PowerShell window on every Bash tool call.
REM
REM Problem: Claude Code (on Windows) invokes the PreToolUse
REM hook command via a plain CreateProcessW with the standard
REM console handle inheritance. Even 'node bin/peaks.js gate
REM enforce' briefly creates a console window before the
REM stdio redirect kicks in. Node's child_process.spawn
REM 'windowsHide: true' only applies to parents that control
REM the spawn (we control dispatch + cron + container
REM children; Claude Code controls the gate-enforce spawn).
REM
REM Fix: launch the gate-enforce CLI inside a hidden
REM PowerShell window via -WindowStyle Hidden. The hidden
REM PowerShell is invisible; its child node process inherits
REM the hidden window and is also invisible. Stdout + stderr
REM are captured by Claude Code via the hook's stdout pipe.
REM
REM This wrapper is Windows-only. POSIX systems keep the
REM direct 'peaks gate enforce' invocation (the symlink on
REM /usr/local/bin/peaks runs as a foreground process with
REM no console flash).

REM %CLAUDE_PROJECT_DIR% is set by Claude Code at hook time.
REM Fall back to "." if it is unset (test seam / manual run).
set "PROJECT_DIR=%CLAUDE_PROJECT_DIR%"
if "%PROJECT_DIR%"=="" set "PROJECT_DIR=."

REM -NoProfile: skip profile load (fast, deterministic)
REM -NonInteractive: no prompts
REM -WindowStyle Hidden: invisible window (the load-bearing
REM   flag for this fix; without it the parent creates a
REM   visible console for the hidden PowerShell)
REM -Command: inline script
powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command ^
  "peaks gate enforce --project '%PROJECT_DIR%'"

exit /b %ERRORLEVEL%
