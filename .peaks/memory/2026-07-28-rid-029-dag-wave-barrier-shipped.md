---
name: rid-029-dag-wave-barrier-shipped-2026-07-28
title: rid-029 DAG wave + barrier shipped (pending commit)
kind: project
description: rid-029 Phase 2E (E direction) ship — DAG wave + barrier with concurrency cap (default 6) + artifact-pass (opt-in); closes audit's E direction "DAG wave 化 + barrier"
metadata:
  type: project
  createdAt: 2026-07-28
  rid: 2026-07-28-rid-029-dag-wave-barrier
  shipCommit: <pending user authorization>
  companion: .peaks/memory/2026-07-28-24h-loop-audit.md (E direction "中高 ROI / 中 24h 关键度")
---

# rid-029 DAG wave + barrier — shipped

> **Status**: implementation + QA verify PASS-WITH-MINOR, RD state=implemented + QA state=verdict-issued, pending user authorize commit (peaks-loop red rule).
> **Trigger**: user 2026-07-28 "把剩下的 A、E、F 顺序完成"; audit's E direction: "DAG wave 化 + barrier (每 wave ≤ 6 并发 + artifact-pass)".
> **scope**: feature — 3 EDIT source files + 1 NEW test. Adds `Wave`/`WaveArtifact`/`WaveOptions` types; `planDispatchWaves` + `runWaveWithArtifacts`; `sub-agent-dispatcher.ts` accepts `Wave[]` + `priorArtifacts`. **Backward-compat**: existing `planDispatch(dag)` API preserved as thin wrapper that flattens `planDispatchWaves` to `DispatchSpec[]`; `runDag` / `runLayeredDag` / `buildDispatchSpec` byte-identical; CLI surface `dispatch-from-dag.ts` untouched (--from-dag flag preserved).

## Why

24h scenarios with ≥20 sub-agents benefit from wave-based concurrency cap (prevents resource contention); artifact-pass enables subsequent slices to consume prior slice outputs. Audit: "中高 ROI / 中 24h 关键度 (sub-agent ≥20 才显著) / 中 风险".

`src/services/code/dag-orchestrator.ts` (393 lines) already had **join barrier primitive** + **pure dispatcher contract** + **failure rollback** + **contract broadcast**. E direction **adds**:
1. **Per-wave concurrency cap** (≤6 concurrent leaves per wave) — currently waves dispatch all leaves at once
2. **Artifact-pass** — when a wave completes, gather contracts into a `WaveArtifact` envelope; next wave's prompt includes the artifact
3. **Wave planner extension** — instead of `DispatchSpec[]` per level (all-at-once), emit `Wave[]` (chunked ≤6 leaves each)

## How to apply

### 4-file diff scope

| # | File | Action | LOC | Description |
|---|---|---|---|---|
| 1 | `src/services/dispatch/slice-dag.ts` | EDIT | 365 (was 299, +66) | Add `WaveOptions` / `WaveArtifact` / `Wave` / `DEFAULT_MAX_CONCURRENCY = 6` / `DEFAULT_WAVE_OPTIONS = { maxConcurrency: 6, passArtifacts: false }` types |
| 2 | `src/services/code/dag-orchestrator.ts` | EDIT | 528 (was 393, +135/-1) | Add `planDispatchWaves(dag, opts)` chunking function + `runWaveWithArtifacts(...)` executor + `planDispatch(dag)` backward-compat wrapper that flattens to `DispatchSpec[]`. Existing `runDag` / `runLayeredDag` / `buildDispatchSpec` byte-identical preserved. |
| 3 | `src/services/dispatch/sub-agent-dispatcher.ts` | EDIT | 633 (was 541, +92) | Add `SliceId` type alias + `DispatchFromWavesInput` + `DispatchFromWavesResult` + `dispatchFromWaves(...)` + `pickDispatcher(...)`. Existing `registerClaudeCodeAwaiter` and earlier exports byte-identical preserved. |
| 4 | `tests/unit/dispatch/dispatch-from-dag-wave.test.ts` | NEW | 116 (6 cases) | TC-1: chunking 8 leaves → 2 waves of 4 / TC-2: 3 leaves → 1 wave / TC-3: 12 leaves → 2 waves of 6 / TC-4: artifact-pass enabled / TC-5: artifact-pass disabled / TC-6: custom concurrency cap |

### QA verify (PASS-WITH-MINOR)

- **AC-E1**: ✅ PASS — all 5 new types + 3 new functions exported; backward-compat `planDispatch(dag)` wrapper returns flat `DispatchSpec[]`; existing `runDag` / `runLayeredDag` / `buildDispatchSpec` byte-identical preserved; CLI surface `dispatch-from-dag.ts` untouched (--from-dag flag preserved per peaks sub-agent dispatch --help)
- **AC-E2**: ✅ PASS — 3 vitest files / **31 tests / 1.42s** green (independent reproduction): `dispatch-from-dag-wave.test.ts` 6/6 + `dag-orchestrator.test.ts` 15/15 regression + `slice-dag.test.ts` 10/10 regression
- **AC-E3**: ✅ PASS — typecheck exit 0; `peaks release precheck --project . --json` overall=ok (all 4 layers green); 5 forbidden auto-compact strings grep EXIT=1 on all 3 source files; AI co-author trailer grep EXIT=1; `peaks audit red-lines --project . --json` exit 0; RD state=implemented + QA state=verdict-issued SUCCESS WITHOUT `--allow-incomplete` (AC-E3 acceptance moment)

### Minor findings (all benign)

1. **QA envelope CLI smoke command was malformed** (`peaks code run --from-dag` is not a valid CLI surface; --from-dag is on peaks sub-agent dispatch). Verified CLI surface untouched via `peaks sub-agent dispatch --help` showing --from-dag flag preserved.
2. **`planDispatch` is NEW, not legacy** (no external callers exist; the "backward-compat" label is forward-looking). Docstring accurately labels it "backward-compat wrapper".
3. **Pre-existing TODO at sub-agent-dispatcher.ts:431** (TODO(g2) legacy silent catch) — pre-existing in HEAD, not introduced by rid-029.
4. **vitest duration variance**: 1.42s vs 1.95s — both well under threshold; env warm-up variance.
5. **LINT_GATE fix (Code-applied post-QA return)**: 6 unfilled placeholder tokens in RD handoff (`<path>`, `<openspec change id>`, `<percent>`) — fixed by filling all placeholders with actual values. PREREQUISITES_MISSING fix: created `qa/test-cases/` + `qa/test-reports/` + QA request artifact with proper schema.

### Caveats the user should know

- **Commit NOT performed by sub-agent** — peaks-loop red rule: orchestrator owns commit; user must authorize. Commit message MUST NOT contain `Co-Authored-By: Claude/Anthropic` trailer; the only valid trailer is the meta `Co-author: SquabbyZ sole author`.
- **`planDispatch` is NEW** (not legacy; no external callers exist). The "backward-compat" docstring is forward-looking — when external callers are added in future slices, they can use either `planDispatch(dag)` (flat) or `planDispatchWaves(dag, opts)` (chunked).
- **`passArtifacts: false` is the default** (opt-in only). The actual artifact-pass integration into the LLM-side runbook is a follow-up slice (similar to how rid-028 deferred the LLM turn-boundary change to rid-032).
- **`runWaveWithArtifacts` is implemented but not yet wired into the dispatcher entry point** — the dispatcher entry point (`dispatchFromWaves`) is a new alternative; existing `dispatchLeaves` flat-dispatch path is preserved as backward-compat.

## 关联

- `.peaks/memory/2026-07-28-24h-loop-audit.md` — E direction source
- `.peaks/memory/2026-07-28-rid-028-context-spillover-storage-shipped.md` — prior ship
- `.claude/plans/giggly-drifting-pizza.md` — full rid-029 plan
- `.peaks/_runtime/2026-07-28-session-22381b/rd/requests/007-2026-07-28-rid-029-dag-wave-barrier.md` — RD handoff (state=implemented)
- `.peaks/_runtime/2026-07-28-session-22381b/qa/requests/009-2026-07-28-rid-029-dag-wave-barrier.md` — QA verdict-issued
- `.peaks/_runtime/2026-07-28-session-22381b/qa/test-cases/2026-07-28-rid-029-dag-wave-barrier.md` — test cases
- `.peaks/_runtime/2026-07-28-session-22381b/qa/test-reports/2026-07-28-rid-029-dag-wave-barrier.md` — test report
- commit `<pending user authorization>` — ship commit (SquabbyZ sole-author, no AI co-author trailer)