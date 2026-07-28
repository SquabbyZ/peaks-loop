---
name: rid-030-dashboard-summary-shipped-2026-07-28
title: rid-030 dashboard summary shipped (pending commit)
kind: project
description: rid-030 Phase 2F (F direction) ship — 24h dashboard metrics (cycle / token / dispatch / compact / monotonic) + NEW `peaks dashboard summary` CLI; closes audit's F direction "24h dashboard 指标"
metadata:
  type: project
  createdAt: 2026-07-28
  rid: 2026-07-28-rid-030-dashboard-summary
  shipCommit: <pending user authorization>
  companion: .peaks/memory/2026-07-28-24h-loop-audit.md (F direction "低 ROI / 中 24h 关键度 (用户感知)")
---

# rid-030 dashboard summary — shipped

> **Status**: implementation + QA verify PASS-WITH-MINOR, RD state=implemented + QA state=verdict-issued, pending user authorize commit (peaks-loop red rule).
> **Trigger**: user 2026-07-28 "把剩下的 A、E、F 顺序完成"; audit's F direction: "24h dashboard 指标 (cycle / token / dispatch / compact / monotonic 次数)".
> **scope**: feature — 6 files (4 EDIT + 2 NEW). Adds 3 new observability categories (cycle / token-usage / monotonic-trigger) + 4 new emit helpers + `aggregateDashboardMetrics` + `DashboardMetrics` type + NEW `peaks dashboard summary` CLI subcommand. **Backward-compat**: existing `peaks dashboard long-run` 5 indicator classes preserved (no behavior change).

## Why

24h runs benefit from user-facing dashboard summary to monitor progress. The 5 metric classes (cycle / token / dispatch / compact / monotonic) provide at-a-glance observability of the 24h run state. Audit: "低 ROI / 中 24h 关键度 (用户感知) / 低 风险".

`src/services/observability/` already has the JSONL append-only store + aggregator. F direction **adds**:
1. **3 new observability categories** (cycle / token-usage / monotonic-trigger) — `dispatch` already existed; `post-compact` already existed; new categories complement existing
2. **4 new emit helpers** (`emitCycleEvent` / `emitTokenUsageEvent` / `emitMonotonicTriggerEvent` / `emitDispatchEvent`)
3. **`aggregateDashboardMetrics` + `DashboardMetrics` type** in `aggregation.ts`
4. **NEW `peaks dashboard summary --since <duration>` CLI** — high-level summary with 5 metrics in a single line

## How to apply

### 6-file diff scope

| # | File | Action | LOC | Description |
|---|---|---|---|---|
| 1 | `src/services/observability/observability-service.ts` | EDIT | 246 (was 147, +99) | Add 3 new categories to `OBSERVABILITY_CATEGORIES` (cycle / token-usage / monotonic-trigger); add 4 new emit helpers |
| 2 | `src/services/observability/aggregation.ts` | EDIT | 360 (was 273, +87) | Add `DashboardMetrics` type + `aggregateDashboardMetrics` function + pure helper |
| 3 | `src/cli/commands/dashboard-commands.ts` | EDIT | 13 (was 11, +2) | Add `registerDashboardSummaryCommand` call |
| 4 | `src/cli/commands/dashboard-summary.ts` | NEW | 68 | CLI command module: `peaks dashboard summary --since <duration> [--project] [--session-id] [--json]` |
| 5 | `tests/unit/cli/observability-commands.test.ts` | EDIT | 307 (was 223, +84) | Extend with 5 new category cases |
| 6 | `tests/unit/cli/dashboard-summary-command.test.ts` | NEW | 163 (7 cases) | 5-metric JSON / cycleCount / tokenCount / compactCount / --since 1h filter / empty session / --project+--session-id |

### QA verify (PASS-WITH-MINOR after 2 fixes)

- **AC-F1**: ✅ PASS — `observability-service.ts` exports 4 new emit helpers; `aggregation.ts` exports `aggregateDashboardMetrics` + `DashboardMetrics`; `dashboard-commands.ts` registers `summary`; `dashboard-long-run.ts` byte-identical (verified by `git diff --stat HEAD`)
- **AC-F2**: ✅ PASS — 3 vitest files / **26 tests / 36.85s** green (independent reproduction): `dashboard-summary-command.test.ts` 7/7 + `observability-commands.test.ts` 13/13 (5 new) + `dashboard-long-run.test.ts` 6/6 regression
- **AC-F3**: ✅ PASS (after 2 fixes) — typecheck exit 0; precheck overall=ok; 5 forbidden auto-compact strings grep EXIT=1 on all 4 EDIT source files; AI co-author trailer grep EXIT=1; `peaks audit red-lines` exit 0; RD state=implemented + QA state=verdict-issued SUCCESS WITHOUT `--allow-incomplete` (AC-F3 acceptance moment)

### 2 transition gate fixes (Code-applied post-QA FAIL return)

1. **LINT_GATE_FAILED** (RD handoff): 6 unfilled placeholder tokens — fixed by filling all placeholders with actual values
2. **PREREQUISITES_MISSING** (QA transition): missing `qa/test-cases/` + `qa/test-reports/` + QA request artifact — fixed by creating all 3 with proper schema

### Minor findings (all benign)

1. **`auto-compact` category renamed**: actual schema uses `post-compact` (not `auto-compact`); RD aligned to actual schema
2. **`dispatch` category pre-existing**: not a new category; just added emit helper
3. **Test count**: 7 dashboard-summary cases (vs plan's 6); added pure-helper consistency test

### Backward-compat verification (CRITICAL for F direction)

- `src/cli/commands/dashboard-long-run.ts` byte-identical to HEAD `339c4dad` (verified by `git diff --stat HEAD`)
- Existing 5 indicator classes (dispatch / autoCompact / monotonicTrigger / subAgentFailure / checkpointFrequency) preserved
- `peaks dashboard long-run --since <duration>` existing CLI surface untouched

## Caveats the user should know

- **Commit NOT performed by sub-agent** — peaks-loop red rule: orchestrator owns commit; user must authorize. Commit message MUST NOT contain `Co-Authored-By: Claude/Anthropic` trailer; the only valid trailer is the meta `Co-author: SquabbyZ sole author`.
- **Audit A-G 7-direction complete**: ✅ B (rid-025) + G (rid-025) + D (rid-026) + C (rid-027) + A (rid-028) + E (rid-029) + F (rid-030) all shipped
- **`peaks dashboard summary` is NEW additive**: existing `peaks dashboard long-run` 5 indicators preserved unchanged (backward-compat verified)
- **5 metric classes**: `cycleCount` / `tokenCount` (cumulative input+output) / `dispatchCount` / `compactCount` (= post-compact events) / `monotonicTriggerCount`. Different counting semantics vs `dashboard long-run` (event-derived cumulative vs state-derived current).
- **`peaks dashboard long-run` 5 indicator classes are still the primary 24h run-time surface**; `peaks dashboard summary` is a post-run summary view.

## 关联

- `.peaks/memory/2026-07-28-24h-loop-audit.md` — F direction source; "低 ROI / 中 24h 关键度 (用户感知) / 低 风险"
- `.peaks/memory/2026-07-28-rid-029-dag-wave-barrier-shipped.md` — prior ship
- `.peaks/memory/peaks-vitest-locked-4-1-10.md` — vitest 4.1.10 lock
- `.claude/plans/giggly-drifting-pizza.md` — full rid-030 plan
- `.peaks/_runtime/2026-07-28-session-22381b/rd/requests/008-2026-07-28-rid-030-dashboard-summary.md` — RD handoff (state=implemented)
- `.peaks/_runtime/2026-07-28-session-22381b/qa/requests/011-2026-07-28-rid-030-dashboard-summary.md` — QA verdict-issued
- `.peaks/_runtime/2026-07-28-session-22381b/qa/test-cases/2026-07-28-rid-030-dashboard-summary.md` — test cases
- `.peaks/_runtime/2026-07-28-session-22381b/qa/test-reports/2026-07-28-rid-030-dashboard-summary.md` — test report
- commit `<pending user authorization>` — ship commit (SquabbyZ sole-author, no AI co-author trailer)