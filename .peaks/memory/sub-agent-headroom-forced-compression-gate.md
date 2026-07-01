---
name: sub-agent-headroom-forced-compression-gate
description: 75% soft warn + 80% hard reject forced compression gate — peaks CLI + PreToolUse hook double-guard, opt-in --use-headroom flag for headroom-ai integration
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-06-06-session-5b1095/prd/requests/002-2026-06-07-sub-agent-dispatch-decouple.md
---

User hard rule (2026-06-07 1:50 GMT+8): "**我觉得可以加红线当上下文达到 75% 的时候,通过 peaks-loop 的 cli 或者 hook 严格要求先压缩我感觉会更好的保证效果**". This is the **forced compression gate** red line. It is orthogonal to G1..G8; registered as G9 in slice #009 PRD. **NOT implemented in slice #009**; tracked for slice #010 follow-up.

## Why

G7 metadata-only is **architectural** (don't inline content). G8 shared channel is **collaborative** (sibling sub-agent status). Neither is a **runtime gate** — they rely on LLM cooperation. G9 is the runtime gate: when context approaches 75% capacity, peaks CLI / hook **forces** compression before allowing dispatch, regardless of LLM self-discipline.

The user's emphasis on "**严格**" (strict) and "**cli 或者 hook**" (CLI or hook — meaning BOTH) signals: this should be a **machine-enforced gate that prose cannot bypass**. Prose-only enforcement (SKILL.md reminders) gets bypassed in practice. G9 is the inverse of the dev-preference red line "skill-first / CLI-auxiliary": when the SKILL.md says MANDATORY, there must be a CLI/hook that enforces it. G9 IS that enforcement.

## The rule (RL-27..RL-32)

**Two-layer enforcement (G9.2)**:
- **CLI 兜底层** — `peaks sub-agent dispatch` / `peaks sub-agent heartbeat --status done` validates prompt size
- **PreToolUse hook 拦截层** — `peaks hooks install` registers a hook that re-validates before LLM-platform-level tool calls
- Both layers implement the same threshold (single source of truth); if either is bypassed, the other catches it

**Threshold calibration (G9.3)** — based on 256K default context capacity:

| Threshold | Prompt size | Behavior |
|---|---|---|
| 50% (early warn) | ≥ 128KB | Soft warning, suggest `--use-headroom` |
| **75% (user red line)** | ≥ 192KB | Soft warning + mandatory suggest `--use-headroom`; not blocked but `warnings: ["CONTEXT_NEAR_LIMIT"]` always returned |
| **80% (hard reject)** | ≥ 204KB | Hard reject `code: "PROMPT_TOO_LARGE"`; not dispatched; user can `--force` override + warning, but not by default |
| 90% (emergency) | ≥ 230KB | Same as 80% + `sliceReport.contextWarning: 'high'` |

**`--use-headroom` flag on existing `peaks sub-agent dispatch` CLI (G9.4)** — opt-in channel for headroom-ai integration:
- Default `false`; G7 metadata-only remains default
- `--headroom-mode` default `balanced` (CCR + Kompress-base; 60-80% reduction)
- Behavior:
  1. CLI calls `headroom.compress(prompt, mode=balanced)` → compressed prompt
  2. Compressed prompt < 75% threshold → dispatch
  3. Compressed still ≥ 80% → reject with "trim prompt further" suggestion
  4. headroom daemon unavailable → `code: "HEADROOM_UNAVAILABLE"` warning + continue dispatch with G7 metadata-only fallback (NOT blocking)

**Dev-preference red line alignment**:
- "`非必要不添加新的 CLI,不是卡死不添加新的 CLI`" — `--use-headroom` adds a flag to existing `peaks sub-agent dispatch`, NOT a new top-level CLI. Red line not violated.
- "skill-first / CLI-auxiliary" — G9 mandatory gate at CLI fallback; SKILL.md explicitly reminds sub-agent "派发前自检 prompt size, 75% 警告 80% 拒绝"
- "dogfood on every adjustment" — G9 implementation must dogfood 3 paths: 75% warning, 80% reject, headroom fallback

**PreToolUse hook implementation (G9.5)**:
```json
{
  "matcher": "Bash",
  "hooks": [{
    "type": "command",
    "command": "peaks sub-agent-dispatch-guard --prompt \"$ARGUMENTS\" --json"
  }]
}
```

`peaks sub-agent-dispatch-guard` (NEW, slice #010) — internal CLI atom that re-validates prompt size + G9.3 threshold + G9.4 headroom channel; returns `{allow: true/false, reason, suggest}` to LLM platform.

**RL-31 Conservative strategy + unobservable fallback**:
- LLM real context capacity is LLM platform's private business; peaks cannot observe (R-1/R-8/R-10 same source)
- G9 uses prompt size as the proxy = conservative strategy
- Accept false positives (large prompt but actual context has room) — user can `--force` to override explicitly
- Better to over-reject than to allow silent truncation (R-10 boundary)

**RL-32 headroom failure fallback**:
- `--use-headroom` calls headroom daemon — if daemon dead / process hangs / times out → `code: "HEADROOM_UNAVAILABLE"` warning + continue dispatch with G7 metadata-only fallback
- NOT blocking — user can still dispatch, just without the headroom compression layer

**RL-30 Hook strictness** — hook does NOT allow `--force` bypass. Hook is the second-layer enforcement; if CLI is bypassed, hook catches; if hook allows `--force`, the gate is no longer a gate.

## Slice #010 follow-up items (G9 NOT in slice #009)

G9 implementation requires:
1. `npm install headroom-ai` (peaks introduces new dependency — slice boundary, dev-preference red line requires separate PRD evaluation)
2. `src/cli/commands/sub-agent-commands.ts` add `--use-headroom` flag + G9.3 threshold validation
3. `src/cli/commands/sub-agent-dispatch-guard.ts` (NEW) — hook-only CLI atom (per G9.5)
4. `src/hooks/pre-tool-use-sub-agent.ts` (NEW) — hook execution body
5. `peaks hooks install` registers G9 segment
6. SKILL.md updates: peaks-solo / peaks-rd / peaks-qa add G9 segment (prompt size self-check + headroom opt-in + hook intercept)
7. `tests/unit/g9-threshold.test.ts` (NEW) — 50% / 75% / 80% / 90% threshold full path tests
8. `tests/integration/g9-e2e.test.ts` (NEW) — real headroom daemon integration test (slice #010 implementation)
9. Real dogfood: run 75% warning + 80% reject + headroom fallback paths

**This slice (slice #009) responsibility boundary**:
- Architecture + red line in PRD (G9 段) — DONE
- AC-44..AC-50 in PRD (slice #010 follow-up) — marked
- Implementation deferred to slice #010 (G7.7 integration route extension)
- RD #009 does NOT implement G9 (RD already done; G9 is post-RD new red line)

## Numerical thresholds in code

```ts
// src/services/context/threshold.ts (slice #010)
export const CONTEXT_CAPACITY_DEFAULT_BYTES = 256 * 1024;  // 256K
export const THRESHOLD_SOFT_WARN_RATIO = 0.5;             // 50%
export const THRESHOLD_NEAR_LIMIT_RATIO = 0.75;           // 75% — user red line
export const THRESHOLD_HARD_REJECT_RATIO = 0.80;          // 80%
export const THRESHOLD_EMERGENCY_RATIO = 0.90;            // 90%
```

## How to apply (when slice #010 implements)

For every sub-agent dispatch by peaks-solo / peaks-rd / peaks-qa:

1. CLI validates prompt size against `THRESHOLD_*` constants
2. < 50%: pass through
3. 50-75%: soft warn (info)
4. 75-80%: soft warn (CONTEXT_NEAR_LIMIT, suggest --use-headroom)
5. 80-90%: hard reject (PROMPT_TOO_LARGE) unless `--force`
6. ≥ 90%: hard reject + emergency warning
7. If `--use-headroom`: try headroom compress; if success < 75% → dispatch; if fail or compress insufficient → reject
8. PreToolUse hook re-validates (no `--force` allowed at hook layer)

For SKILL.md updates:

1. Add G9 segment to peaks-solo / peaks-rd / peaks-qa SKILL.md (mandatory gate reminder)
2. Update sub-agent prompt templates with prompt size self-check

## What does NOT satisfy the rule

- "Sub-agent 跑飞 prompt, peaks 放过" (violates G9 — gate is a gate)
- "75% 是软警告, 80% 也只是警告" (violates RL-28 — 80% is hard reject by default)
- "`--force` 在 hook 层也能用" (violates RL-30 — hook is the strictest layer)
- "headroom daemon 死了就阻塞派发" (violates RL-32 — fallback to G7 metadata-only)
- "信任 LLM 自报 context 占用" (violates RL-31 — LLM 行为不可观测, peaks 用 prompt size 保守估算)

## Cross-reference

- **PRD #009** G9 段 + AC-44..AC-50 (slice #010) + R-13
- **RD request #009** G9 in-scope (slice #010)
- [[sub-agent-context-minimal-occupation]] — companion G7 rule; G7 is the architecture default, G9 is the runtime gate on top
- [[sub-agent-shared-channel-cross-completion]] — companion G8 rule; G8 share value size threshold (RL-25) syncs with G9 prompt size threshold
- [[peaks-memory-scan-is-intentionally-not-a-cli]] — precedent: when SKILL.md says MANDATORY, there must be CLI/hook enforcement; G9 IS that enforcement
- [[skill-red-lines-need-cli-backing]] — converse red line; G9 exemplifies the rule

## Why this is additive, not a replacement

G7 (content occupation) / G8 (cross-completion) / G9 (forced gate) are three layers of context discipline:

| | G7 (architectural) | G8 (collaborative) | G9 (runtime gate) |
|---|---|---|---|
| Concern | Don't inline content | Sibling sub-agent status | Force compression at threshold |
| Question | Does main LLM get MB artifacts? | Do in-flight sub-agents know what siblings finished? | Is prompt size below 75% / 80% threshold? |
| Failure mode | Main LLM silent-truncate | Sub-agent B redoes A's work | LLM silent-truncate when context fills |
| Mitigation | Metadata-only + 按需 Read | Shared channel | CLI + hook double-gate + headroom opt-in |

G7 + G8 + G9 together implement **layered context discipline**: G7 makes the architecture clean, G8 makes sub-agent cooperation possible, G9 makes the runtime gate a gate. Slice #010 implements G7 + G8 + G9 together as a single context-governance push.
