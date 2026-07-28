---
name: rid-026-monotonic-jsonl-store-shipped-2026-07-28
title: rid-026 monotonic cycle jsonl-store replacement shipped (pending commit)
kind: project
description: rid-026 Phase 2B (D direction) ship — replace cycle-N.json N-file pattern in `monotonic-runner.ts` with single jsonl-store per session; closes audit's second-knife recommendation
metadata:
  type: project
  createdAt: 2026-07-28
  rid: 2026-07-28-rid-026-monotonic-jsonl-store
  shipCommit: <pending user authorization>
  companion: .peaks/memory/2026-07-28-24h-loop-audit.md (audit's second-knife)
---

# rid-026 monotonic cycle jsonl-store replacement — shipped

> **Status**: implementation + QA verify PASS, pending user authorize commit (peaks-loop red rule).
> **Trigger**: user 2026-07-28 显式 "立即执行吧" after rid-025 ship; audit's second-knife recommendation (D = low ROI / medium 24h-criticality / very-low risk / ~30 min + 1 vitest).
> **scope**: refactor — 2 EDIT files (monotonic-runner.ts + monotonic-guard.test.ts fixture migration). Cycle persistence path now writes one jsonl line per cycle; reads tail-scan for the most recent `kind === 'monotonic-cycle'` line.

## Why

24h run produces ~100 cycles accumulating 100-300ms of `readdirSync` + per-cycle N-file writes. Replacing the cycle-N.json N-file pattern with a single append-only jsonl-store line per cycle gives O(1) writes (append) + O(N) reads (tail-scan, ~50-100× faster than per-cycle readdirSync+regex+readFileSync). Reuses existing `appendMetricLine` + `readMetricLines` from `src/services/observability/jsonl-store.ts` — no new helpers needed.

**Scope correction**: audit brief says "改 `run-driver.ts` 持久化层" but the actual cycle-N.json write/read logic lives in `src/services/loop/monotonic-runner.ts` (280 lines). `run-driver.ts:334` only calls `nextCycleIndex(...)` (N counter); `run-driver.ts:153` derives `cyclesDir` from `sliceDir` for its own writer (separate concern, out of scope). Surgical fix targets the writer file, not run-driver.ts.

## How to apply

### 2-file diff scope

| # | File | Action | LOC | Description |
|---|---|---|---|---|
| 1 | `src/services/loop/monotonic-runner.ts` | EDIT | 334 (was 280, +54) | Replace writer (line 302 `appendMetricLine` with `kind: 'monotonic-cycle'` envelope) + reader (line 130 `readMetricLines` + tail-scan filter for `kind === 'monotonic-cycle'`) + `nextCycleIndex` (read last_cycle + 1); preserve `loadMostRecentCycleFromSubAgents` legacy `_sub_agents/<sid>/shared/` cross-batch fallback verbatim for BC |
| 2 | `tests/unit/loop/monotonic-guard.test.ts` | EDIT | 232 (was 208, +24) | Migrate test fixtures from `cycle-N.json` writes to `appendMetricLine` calls; added 1 new case verifying lines for other rids are ignored (rid filter — necessary because jsonl-store is per-session, not per-slice) |

### QA verify (PASS)

- **AC-D1**: jsonl-store adoption — grep confirms zero `writeFileSync(.*cycle-` or `readdirSync.*cycle-` in writer path; `appendMetricLine` + `readMetricLines` imported (line 34) and used at lines 130 + 302
- **AC-D2**: vitest `tests/unit/loop` → **8 files / 121 tests all green / 101.45s**; monotonic-guard 16/16 (15 existing + 1 new for rid filter); `tests/unit/services/observability/jsonl-store.test.ts` 16/16 regression green
- **AC-D3**: typecheck exit 0; `peaks release precheck --project . --json` overall=ok; RD request state `implemented` confirmed via `peaks request show` (transitioned without `--allow-incomplete` as required)
- **Public API preservation**: all 4 functions (`sliceDir` / `loadPreviousCycle` / `nextCycleIndex` / `runMonotonicCheck`) exported with unchanged signatures; 4 interfaces (`MonotonicCycle` / `MonotonicScoreRow` / `MonotonicReport` / `MonotonicRegression` in `monotonic-guard.ts`) intact. `MonotonicStrategy` listed in QA envelope was a phantom (zero occurrences in repo).
- **Surgical scope**: rid-024 / rid-025 / rid-020b / rid-020a files byte-identical to HEAD `b4052429`; `monotonic-guard.ts` + `run-driver.ts` + `jsonl-store.ts` byte-identical; no package.json / tsconfig.json / pnpm-lock.yaml changes
- **Red-line grep**: no AI co-author trailers; 6 `<sid>` matches are pre-existing JSDoc/test-name literal placeholders (verbatim `<sid>`, not live session-id)

### Caveats the user should know

- **Commit NOT performed by sub-agent** — peaks-loop red rule: orchestrator owns commit; user must authorize. Commit message MUST NOT contain `Co-Authored-By: Claude/Anthropic` trailer; the only valid trailer is the meta `Co-author: SquabbyZ sole author`.
- **`run-driver.ts` has its own `cyclesDir` writer at line 153** — separate concern from cycle persistence; OUT OF SCOPE for this slice. Could be a future rid (rid-029 candidate) if the same jsonl-store pattern is desired for `run-driver`'s cyclesDir writer.
- **`loadMostRecentCycleFromSubAgents` legacy fallback** — retained verbatim for cross-batch signal (reads `cycle-N.json` files under `.peaks/_sub_agents/<sid>/shared/`). This is a separate concern from cycle persistence; AC-D1 only required the primary cycle persistence path use jsonl-store.
- **`MonotonicStrategy` in QA envelope was phantom** — QA agent flagged it doesn't exist anywhere; treated as a documentation oversight. Real interface names are in `monotonic-guard.ts`.
- **QA envelope path `tests/unit/observability/jsonl-store.test.ts` was wrong** — actual path is `tests/unit/services/observability/jsonl-store.test.ts`. No code impact; documentation correction only.

## 关联

- `.peaks/memory/2026-07-28-24h-loop-audit.md` — D direction source; audit's second-knife
- `.peaks/memory/2026-07-28-rid-025-heartbeat-watch-and-ban-shipped.md` — prior ship
- `.peaks/memory/2026-07-28-rid-024-code-commands-split-shipped.md` — refactor ship
- `.claude/plans/giggly-drifting-pizza.md` — full rid-026 plan
- `.peaks/_runtime/2026-07-28-session-22381b/rd/requests/004-2026-07-28-rid-026-monotonic-jsonl-store.md` — RD handoff (state=implemented)
- `.peaks/_runtime/2026-07-28-session-22381b/qa/requests/004-2026-07-28-rid-026-monotonic-jsonl-store-verify.md` — QA verify (PASS)
- commit `<pending user authorization>` — ship commit (SquabbyZ sole-author, no AI co-author trailer)