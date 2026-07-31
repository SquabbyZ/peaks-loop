---
name: peaks-loop-mac-auto-compact-no-env-injection
description: peaks auto-compact fails on Mac Claude Code because CLAUDE_CONTEXT_USAGE_PERCENT env var is not injected into hook subshells and transcript fallback is also broken — NOT a Windows hard-coding issue
metadata: 
  node_type: memory
  type: project
  originSessionId: ed56a640-2724-4d8f-b391-86ce1095ce1f
  modified: 2026-07-31T06:46:04.140Z
---

# Mac auto-compact silent failure — root cause sediment (2026-07-31)

## Symptom
On Mac Claude Code, user runs `/context` and sees `399k/200k tokens (199%)` — but
`peaks code context-now --json` returns `ratio: 0, source: 'conservative-fallback', action: 'ok'`.
The PreToolUse auto-compact hook therefore never fires. User asked: "is peaks auto-compact
windows 环境硬编码了?" — answer: **no, the code is platform-neutral; the failure is
upstream of the code, in the env-var contract Claude Code uses to expose context %**.

## What I ruled out (Phase 1 + 2 of systematic-debugging)

| Candidate | Status | Evidence |
|---|---|---|
| Windows-only hard-coding in auto-compact code path | **ruled out** | `rg -n "win32\|process\.platform" src/services/{context,hooks,runtime}` finds ZERO platform branches in `auto-compact-{reader,dispatcher,orchestrator,hook-install}.ts` and `claude-code-adapter.ts`. All paths use `homedir()` + `join()` — pure POSIX + Windows-safe. |
| IDE detection broken on Mac | **ruled out** | `ide-detect.ts` reads `CLAUDE_CODE_ENTRYPOINT=cli` correctly on Mac and resolves `claude-code`. |
| Hook install writes wrong path on Mac | **ruled out** | `auto-compact-hook-install.ts` writes `.claude/settings.local.json` via `join()` — same path on Mac/Linux/Windows. |
| `claude --compact` not on PATH | **not the trigger** | `claude --compact` is the *consequence* (step 7 of the chain), not the gate. The gate is whether the env var fires the hook at all. |

## Root cause (Phase 3) — two compounding bugs

### Bug 1: `CLAUDE_CONTEXT_USAGE_PERCENT` is not injected on Mac

`auto-compact-reader.ts:73` (via `claude-code-adapter.ts:73`) reads this env var as the
**only** primary signal. Verified on the user's Mac shell:

```
$ echo $CLAUDE_CODE_ENTRYPOINT
cli          ← injected
$ echo $CLAUDE_SESSION_ID
             ← empty
$ echo $CLAUDE_CODE
             ← empty
$ echo $CLAUDE_CONTEXT_USAGE_PERCENT
             ← EMPTY  ← this is the load-bearing signal
```

The `/context` slash command can compute 199% because that runs *inside* the Claude Code
process; `CLAUDE_CONTEXT_USAGE_PERCENT` is a separate env-var channel that
**apparently isn't wired into the Mac Claude Code build** (or is wired but not propagated
to PreToolUse hook subshells). Either way, peaks-loop's primary signal is **absent on Mac**.

This is upstream of peaks-loop and not a code bug. But peaks-loop's design assumes the
env var is present, so Mac users silently lose auto-compact.

### Bug 2: Transcript fallback also broken (compounds the failure)

`auto-compact-reader.ts:86-103` — when the env var is missing, it walks
`~/.claude/projects/<hash>/<sid>.jsonl` and returns
`ratio = min(1, bytes / 256KB)`. On the user's Mac:
- `~/.claude/statusline-state.json` does NOT exist (statusline poll path N/A)
- Transcript fallback returns `null` (no `existsSync` hit on the hashed path)
- Final fallback: `ratio: 0` with `source: 'conservative-fallback'`
- Orchestrator stays in `none` / `soft-warn` zone → `evaluateAutoCompactDecision`
  returns `shouldCompact: false` → `runAutoCompact` returns `AUTO_COMPACT_SKIP`

The "conservative-fallback" with ratio=0 is **operationally broken**: it's a sentinel that
should be treated as "I don't know", but the orchestrator's `evaluateCompactTrigger`
treats `ratio < 0.5` as `kind: 'none'` and skips. This is the secondary bug — even when
the primary signal is missing, the fallback should at least produce *some* usable
estimate from the transcript jsonl.

## Why the user's question was reasonable but wrong

`peaks-loop` has a known Windows shell preference (see `2026-07-27-windows-shell-pref.md`)
and a lot of "Windows vs Mac" surface in its CLI (statusline, hooks install, skill
sync). It's *plausible* that auto-compact would have a Windows-only code path. But
the code path is genuinely platform-neutral — the bug is in the **upstream contract**
(env-var injection) and in a **secondary fallback that is too conservative** to
rescue the situation.

## Fix options (recommended: B)

| Option | What it changes | Tradeoff |
|---|---|---|
| **A. Robust transcript fallback** | Fix `readClaudeTranscriptFallback` to glob `~/.claude/projects/**/${sessionId}.jsonl` and trust bytes/256KB as the ratio when env is absent. | Self-contained. Proxy, not exact. |
| **B. Multi-source fusion** (recommended) | A + add `--prompt-size <bytes>` override on `peaks context check` so user can pipe bytes in; treat `conservative-fallback` with non-zero bytes as `source: 'transcript-estimate'` and pass it to the orchestrator. | Cross-platform, zero Claude Code coordination. Adds 1 small CLI flag. |
| **C. Probe via `claude status --json`** | In the hook, shell out to `claude` to get real context % before firing. | Authoritative but requires a `claude status` verb that may not exist. |

Recommended path: **B** — minimal-diff, no Claude Code cooperation, matches the
"peaks-loop is enhancement, not new CLI" rule.

## Files to edit when implementing B

1. `src/services/context/auto-compact-reader.ts` — fix `readClaudeTranscriptFallback` glob
2. `src/cli/commands/context-check.ts` (or wherever `--prompt-size` lives) — confirm it
   is wired into `readContextPercent` as a third source
3. `src/services/context/auto-compact-types.ts` — add a `transcript-estimate` source
   variant so callers can distinguish "env said X" from "fallback said X"
4. `src/services/code/auto-compact-orchestrator.ts` — when source is `transcript-estimate`
   AND ratio ≥ 0.85, fire (currently conservatively skipped)

## Test gap

`tests/unit/context/auto-compact-reader.test.ts` should have a Mac-simulation case
where `env = {}` and the transcript file exists at a non-canonical hash subdir, to
prevent regression on the glob rewrite.

**Why:** Without a sediment, the next time someone asks "why does Mac auto-compact not
work?" the same Phase 1/2/3 sweep will repeat. The cost of writing this fact is small;
the cost of re-discovering is 20+ minutes of systematic-debugging.

**How to apply:** When the user files any future "auto-compact not working" issue, read
this file FIRST. If the IDE is Claude Code on Mac, skip straight to Phase 3 and confirm
the env var is missing before proposing code changes. Do not re-run the Windows-
hard-coding grep — it has been verified clean as of 2026-07-31.

Related: [[peaks-loop-24h-ai-programmer-positioning]] (peaks-loop is enhancement, not
new CLI — Mac env-var gap is an upstream contract issue, not a peaks-loop bug per se);
[[2026-07-27-windows-shell-pref]] (different platform-class issue, but same pattern:
verify the actual env before proposing code changes).
