---
name: 2026-06-26-v2-11-main-session-context-monitor
description: v2.11.0 D6 — monitor main-session context window and auto-trigger compact; Claude Code uses its own /compact, other IDEs use LLM self-compress. Companion to D5 (full-auto self-decision).
metadata:
  type: project
---

# v2.11.0 — D6: main-session context monitor + IDE-aware compact

> Decided in session `2026-06-26-session-a28d69` immediately after D5.
> **Status:** direction agreed; **PRD draft pending**; will merge into the same v2.11.0 slice as D1–D5.
> **Why this matters:** the existing context governance (G7–G9, in `references/context-governance.md`) is about **sub-agent dispatch prompts**, not the **main-session LLM context window**. The user just reported: "需要监控主 session 的 context, 如果使用的是 claude code 就用 claude code 的 compact 命令, 不是 claude 就让 LLM 自己压缩". So far peaks-cli has no runtime monitor for the main session itself; D5/D6 close that gap.

## The pain (literal user quote)

> "还有监控主 session 的 context，如果使用的是 claude code 就用 claude code 的 compact 命令，不是 claude 就让 LLM 自己压缩"

Translation: peaks-solo must monitor the **main-session** context window (not just sub-agent prompts). When context fills, the response shape is IDE-dependent:
- **Claude Code** — invoke the IDE's native `/compact` slash command (or equivalent) — the runtime owns the compression
- **Other IDEs** — the LLM itself performs the compression by summarizing prior turns (write to `.peaks/_runtime/<sid>/txt/context-compress-<N>.md`, then continue)

## The new rule (locked — D6 in v2.11.0)

### D6.a — IDE detection is the load-bearing first step

The peaks-solo skill runs in many IDEs (Claude Code, Trae, opencode, future adapters). The compact trigger MUST detect the host runtime BEFORE choosing the trigger path. Use the existing `peaks ide detect --json` CLI (from slice 021's IDE-adapter layer — see memory `peaks-cli-1-3-3-will-be-the-first-release-with-the-ide-adapter-layer`). If `peaks ide detect` is unavailable, fall back to env vars: `CLAUDE_CODE_ENTRYPOINT` (Claude Code), `TRAE_CLI` (Trae), etc.

### D6.b — Threshold table (main-session context, distinct from G9 sub-agent threshold)

| Threshold | Prompt size (assumed 256K default) | Behavior |
|---|---|---|
| 50% (early warn) | ≥ 128K | Log `context warning: 50%`; emit suggestion to checkpoint |
| 75% (user red line) | ≥ 192K | Log `context warning: 75%`; **trigger compact** per D6.c |
| 90% (emergency) | ≥ 230K | Trigger compact + emit `code: "CONTEXT_EMERGENCY"` |

These thresholds are the same numbers as G9 but apply to **main-session prompt size**, not sub-agent dispatch prompt size. Two separate metrics; one source-of-truth helper file `src/services/context/threshold.ts` already exists from G9 — extend it with a `mainSessionThreshold()` getter, do not duplicate.

### D6.c — Trigger path is IDE-dependent

```text
if (threshold >= 75%) {
  if (ide === 'claude-code') {
    // emit tool call to invoke /compact (slash command)
    return invokeIdeNativeCompact();
  } else {
    // LLM self-compresses:
    //   1. Write prior-turn summary to .peaks/_runtime/<sid>/txt/context-compress-<N>.md
    //   2. Continue with compressed context (the summary file is now the memory)
    return llmSelfCompress();
  }
}
```

`invokeIdeNativeCompact()` returns a result envelope: `{ ok, compressedTurns, remainingTokens, nextActions }`. Claude Code's `/compact` is a slash command, so the skill emits a `Skill` / `Bash` tool call (per the IDE-adapter layer). Trae/opencode adapters expose their own compression APIs — the adapter registry (slice 021) owns that mapping.

`llmSelfCompress()` emits a structured markdown file:

```markdown
# Context Compression N — <iso8601>

## What was decided (locked)
- ...

## What was tried (succinct)
- ...

## Open questions
- ...

## Next action
- ...
```

Path convention: `.peaks/_runtime/<sessionId>/txt/context-compress-<N>.md` (N is monotonic, starts at 1, gitignored). The file is the new "ground truth" for the session after compression; the LLM continues from this file rather than the prior turns.

### D6.d — Always log, never silently skip (matches D5.a)

Every compact invocation emits a log line and appends to `.peaks/_runtime/<sid>/txt/auto-decisions.md`:

```
2026-06-26T12:34:56Z context threshold=77% trigger=claude-code-/compact turns=42 → 18 (57% reduction)
2026-06-26T14:01:12Z context threshold=80% trigger=llm-self-compress file=context-compress-2.md turns=31 → summary
```

The peaks-txt Step 10 audit table picks these up automatically.

### D6.e — Hard floor: do NOT auto-compact mid-tool-call-batch

If a sub-agent batch is in flight (`.peaks/_sub_agents/<sid>/shared/` has un-read entries), wait for the batch to converge before compacting. Rationale: compacting mid-batch loses the shared-channel state mid-flight; the next batch cannot reconstruct. The wait-state caps at 60s; on timeout, emit `code: "CONTEXT_COMPACT_DEFERRED"` and continue (do not block).

### D6.f — Periodic checkpoint (already in SKILL.md Step N) is the lower-cost complement

Step N already says "fire `--reason periodic` every 20 tool calls" and "`--reason context-fill` when context feels full". D6 is the **automatic** complement: when the threshold hits 75% programmatically (not LLM-feel), trigger. The two coexist — periodic checkpoint is the soft signal (3-5k tokens saved per checkpoint), D6 is the hard signal (must compress before next turn).

## Concrete change list for the v2.11.0 slice

- **D6.g — New module** `src/services/context/main-session-monitor.ts` — owns the threshold check + IDE detection + trigger dispatch
- **D6.h — Extend** `src/services/context/threshold.ts` — add `mainSessionThreshold()` getter (don't duplicate the G9 sub-agent table)
- **D6.i — New CLI** `peaks context status --json` + `peaks context check --auto-trigger --project <repo> --json` — so the LLM (and humans) can probe
- **D6.j — SKILL.md Step N+2** — new "main-session context monitor" step, between Step N (periodic checkpoint) and Step N+1 (final review). Document the threshold table + IDE detection + trigger paths
- **D6.k — Test** `tests/unit/services/context/main-session-monitor.test.ts` covering: 4 IDE types × 3 thresholds × 2 trigger paths = 24 cases; plus the in-flight-batch deferral test
- **D6.l — Test** `tests/unit/skill-context-monitor.test.ts` covering SKILL.md Step N+2 prose + the log-line shape

## Multi-CC implementation — add to Group F (D5 + D6 together)

D5 and D6 are both "remove friction at runtime" features. Combine into one CC (Group F → rename Group F to "D5 self-decision + D6 context monitor"):

- Shared module: `src/services/solo/mode-gate.ts` (D5) and `src/services/context/main-session-monitor.ts` (D6)
- Shared CLI additions: `peaks solo should-pause` (D5) + `peaks context check` (D6)
- Shared SKILL.md Step N+2 update (D6) and 14-row patch (D5)
- Combined test: `tests/unit/services/runtime-friction.test.ts` covering both

## Why this is additive, not a replacement

- G7-G9 (sub-agent context governance) — unchanged. D6 covers main-session only.
- Step N (periodic checkpoint, every 20 calls) — unchanged. D6 is the programmatic complement.
- peaks-txt Step 10 (handoff capsule) — unchanged. D6 just writes context-compress-N.md files that txt picks up.
- The 75% threshold matches the G9 user red line; the 90% emergency matches G9's emergency tier. Single mental model across both metrics.

## Open questions

- Should `invokeIdeNativeCompact()` be a wrapper around a slash command (`/compact`) or a direct native API call? Slash command is portable but adds a round-trip; native API is faster but IDE-specific. Lean slash command (portability wins for v0).
- Should D6 trigger on context-fill at 75% even if the LLM just checkpointed 5 tool calls ago? Probably yes (the periodic checkpoint is the soft signal; D6 is the hard signal). Add a 5-tool-call cooldown to prevent thrashing if thresholds oscillate.
- Should the `context-compress-N.md` files be merged into a single `context-compress.md` at session end? Or stay separate so the user can audit each compression? Lean stay-separate (auditability wins).
- For non-Claude-Code IDEs that don't have a native compact command and where the LLM cannot reliably self-compress (small models), what's the fallback? Possible answer: refuse the slice with `code: "CONTEXT_COMPRESS_UNSUPPORTED"` and ask the user to start a new session.

## Related memory / docs

- [[2026-06-26-v2-11-full-auto-self-decision]] — sibling (D5). Same "remove runtime friction" philosophy. Together: D5 = "stop pausing unnecessarily"; D6 = "monitor and compact when full".
- [[2026-06-26-v2-11-rm-rd-techdoc-immutable-handoff]] — companion architectural change (D1-D4)
- `references/context-governance.md` — existing G7-G9 sub-agent threshold table. D6's main-session table extends the same source-of-truth (`src/services/context/threshold.ts`).
- `peaks-cli-1-3-3-will-be-the-first-release-with-the-ide-adapter-layer` — slice 021's IDE-adapter layer is the dependency for D6.a IDE detection.

## Session info

- Session id: `2026-06-26-session-a28d69`
- Started: 2026-06-26 00:35 UTC+8
- Discovered: user message immediately after D5 memory write "还有监控主 session 的 context..."
- Compaction: 3rd in this session, pending after this memory write