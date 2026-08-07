---
name: peaks-loop-mac-esm-defense-audit
description: "SLICE 8 — verified on Windows that all 5 anti-fake-green defenses for the Mac auto-compact ESM bug are still in place (readClaudeTranscriptFallback / readClaudeStatuslinePercent / presence-marker-detector / post-compact-detector / step-08-gate); 0 follow-up work required."
metadata:
  node_type: memory
  type: project
  originSessionId: 2026-08-06-session-cacde8
  modified: 2026-08-07T00:00:00.000Z
---

# Slice 8 — Mac auto-compact ESM anti-fake-green defense audit (2026-08-07)

## Audit result

**5/5 defenses present. 0 missing. 0 follow-up dispatched.**

| # | Defense                          | Source path                                                            | Status |
|---|----------------------------------|------------------------------------------------------------------------|--------|
| 1 | `readClaudeTranscriptFallback`   | `src/services/context/auto-compact-reader.ts` line 141                | OK     |
| 2 | `readClaudeStatuslinePercent`    | `src/services/context/auto-compact-reader.ts` line 70                 | OK     |
| 3 | `presence-marker-detector`       | `src/services/hooks/presence-marker-detector.ts` + test                | OK     |
| 4 | `post-compact-detector`          | `src/services/code/post-compact-detector.ts` + test                    | OK     |
| 5 | `step-08-gate`                   | `src/services/code/step-08-gate.ts` + test                             | OK     |

## Verification trail

### Defense 1 — `readClaudeTranscriptFallback` (auto-compact-reader.ts L141)

Recursive `findTranscriptJsonl` helper at L102 walks the `~/.claude/projects/`
tree depth-first, returning `{ path, bytes }` for the matching
`<sessionId>.jsonl`. Tagged `source: 'transcript-estimate'` (v2.14.0) on the
public `readContextPercent` envelope so callers can distinguish this real
signal from `ratio: 0` conservative-fallback.

ESM-safe: imports `readdirSync` from `node:fs` at the top of the module
(line 25) — no in-body `require()` call. The 2-line fix at commit `22debcb`
is still in effect.

### Defense 2 — `readClaudeStatuslinePercent` (auto-compact-reader.ts L70)

Reads `~/.claude/statusline-state.json` and probes `contextPercent` /
`context_usage_percent` / `contextPercentUsed` keys. Tagged
`source: 'statusline-poll'`. The catch block at L82 explicitly re-throws
`ReferenceError` / `SyntaxError` so a future ESM / JSON-parse regression
can never silently return `null` (TODO(g2) carry-forward per the
silent-catch-guard memory).

### Defense 3 — `presence-marker-detector` (`src/services/hooks/`)

Pure read-only function `detectPresenceMarker({ project, latestAssistantMessage })`
that decides whether the `Peaks-Loop Skill:` / `Peaks-Loop Gate:` header
was emitted on the most recent assistant turn. Drives the slice-028
detection mechanism that prevents skill context loss across compaction.

Companion test: `tests/unit/hooks/presence-marker-detector.test.ts` (exists).

### Defense 4 — `post-compact-detector` (`src/services/code/post-compact-detector.ts`)

Implements D7 from `.peaks/memory/2026-06-26-v2-11-post-compact-resume.md`.
Reads `.peaks/_runtime/<sid>/checkpoints/` and decides whether the next
LLM turn must auto-resume from a fresh compaction. Tagged reasons cover
`post-compact-match` / `sid-unbound` / `runtime-dir-missing` /
`no-checkpoint-today` / `no-mode-field` / `stale-checkpoint` /
`multiple-checkpoints-ambiguous` / `active-skill-mismatch` /
`checkpoint-read-failed`.

Companion test: `tests/unit/code/post-compact-detector.test.ts` (exists).

### Defense 5 — `step-08-gate` (`src/services/code/step-08-gate.ts`)

v3.1.2 Step 0.8 mechanical PreToolUse gate. Reads `job-shape.json` and
either allows the Bash tool call (with structured stdout describing
the decision) or blocks with exit 2 + `BLOCKED:` stderr. Backup regex
`/直到|全部|until all done|disavow cost|不用考虑费用|all of them/i` is the
fail-closed safety net for the v3.1.1 incident class.

Companion test: `tests/unit/code/step-08-gate.test.ts` (exists).

## Why this audit was needed

Per `.peaks/memory/2026-07-31-mac-auto-compact-esm-fake-green-and-fix.md`:

- Mac Claude Code does NOT inject `CLAUDE_CONTEXT_USAGE_PERCENT`.
- The cycle-0 fix at commit `872985f` had an ESM `require is not defined`
  ReferenceError inside `findTranscriptJsonl`.
- vitest's esbuild loader shim made the 6/6 unit pass a phantom — same
  class of bug as the B1 coverage global-setup false-positive.
- The cycle-1 fix at commit `22debcb` was 2 lines and ship-ready; the
  QA repro confirmed production ESM runtime correctness.

The 5 defenses listed above are the post-fix structural changes that
prevent this class of bug from re-appearing. This slice re-verifies them
on the current Windows machine.

## What this slice DID NOT do

- No code changes (audit-only).
- No test changes (the anti-fake-green doctrine).
- No new follow-up — every defense is in place and exercised by its test.
- No commit — this is a sediment file per the task contract ("If
  everything is in place, just write a sediment file").

## Files touched

- `.peaks/memory/2026-08-07-mac-esm-defense-audit.md` (NEW, this file)

## Carry-forward / next audit window

- 73 TODO(g2) legacy silent-catch carry-forwards remain across the
  codebase per `2026-07-31-rid-001-r2-silent-catch-guard.md`. The two in
  `auto-compact-reader.ts` (L82, L123) are the closest to this slice's
  concern; both have already been narrowed to surface `ReferenceError` /
  `SyntaxError` and swallow only IO errors. Priority 1 carry-forwards
  are `post-compact-detector` and `step-08-gate`.
- The ESM `require()` grep from the original memory
  (`rg -nE 'require\(.node:' src/services/ packages/*/src/`) returned
  0 hits on this machine — no latent ESM ReferenceError waiting to
  happen.

**Why:** without this sediment, the next peaks-code session would have to
re-audit the 5 defenses from scratch when a follow-up slice raises the
"is the Mac fix still solid?" question.

**How to apply:** when the next Mac-related auto-compact regression is
reported, diff this audit against the current `auto-compact-reader.ts`
to confirm the 5 defenses are still in place; if any are absent, treat
that as a hard regression and dispatch a follow-up before any other
auto-compact work.