---
name: rid-032-turn-boundary-shipped-2026-07-28
title: rid-032 A turn-boundary shipped (pending commit)
kind: project
description: rid-032 follow-up slice ship — A turn-boundary (LLM no-context mode) MINIMAL: 1 NEW CLI `peaks session spill-demo` + 1 SKILL.md opt-in experimental subsection + 1 NEW test; auto-compact-orchestrator.ts D6.e branch preserved verbatim
metadata:
  type: project
  createdAt: 2026-07-28
  rid: 2026-07-28-rid-032-turn-boundary
  shipCommit: <pending user authorization>
  companion: .peaks/memory/2026-07-28-rid-031-dispatcher-deprecation-shipped.md (prior ship; HEAD 1f55eac9)
---

# rid-032 A turn-boundary (LLM no-context mode MINIMAL) — shipped

> **Status**: implementation + QA verify PASS, RD state=implemented + QA state=verdict-issued, pending user authorize commit (peaks-loop red rule).
> **Trigger**: user 2026-07-28 "把031、032、033都完成再通知我".
> **scope**: feature — opt-in experimental integration of spill/hydrate API from rid-028. **Auto-compact-orchestrator.ts D6.e branch preserved verbatim** (no behavior change). 5 files: 2 NEW (spill-demo-command.ts 64 lines + spill-demo-command.test.ts 83 lines, 4 cases) + 3 EDIT (_register.ts +2 + session-command.ts +2 + SKILL.md +10).

## Why (risk-mitigation)

Per audit `2026-07-28-24h-loop-audit.md` A direction: "context-spillover to disk (D6.e alternative) — 影响 LLM turn 边界语义, 需完整 design slice". Audit: "高 ROI / 极高 24h 关键度 / **大 风险**".

**Risk-mitigation strategy (bounded experimental integration)**:
1. **Opt-in only**: new SKILL.md prose tells the LLM "you MAY call spill/hydrate when in 24h mode". The LLM is NOT forced to use it.
2. **Behavioral safety**: spill() writes a SpillRecord; when batch lands, hydrate(spillId) returns the deferred state. Idempotent — the LLM can ignore the spill and the existing D6.e deferral still works.
3. **No core LLM behavior change**: `auto-compact-orchestrator.ts` D6.e branch is preserved verbatim (per established pattern from rid-028). The spill/hydrate integration is **additive documentation** + a small CLI helper for the LLM to test the flow.

## How to apply

### 5-file diff scope

| # | File | Action | LOC | Description |
|---|---|---|---|---|
| 1 | `src/cli/commands/spill-demo-command.ts` | NEW | 64 | `registerSpillDemoCommand(parent, io)`; CLI `peaks session spill-demo --session-id <sid> [--project] [--batch-id] [--json]`; calls `spill()` + `listSpills()` + `hydrate()`; returns JSON envelope with `spilled.spillId` + `totalSpills` + `hydrated` |
| 2 | `src/cli/commands/_register.ts` | EDIT | 156 (was 154, +2) | Add import + `['session-spill-demo', registerSpillDemoCommand]` registration entry |
| 3 | `src/cli/commands/core/session-command.ts` | EDIT | 281 (was 279, +2) | Add import + eager session registration (so the `session` parent can call into spill-demo's registration) |
| 4 | `skills/peaks-code/SKILL.md` | EDIT | 295 (was 285, +10) | Append new "## 24h mode spill/hydrate (opt-in experimental, rid-032)" subsection at line 83 (after existing 24h mode chapter) |
| 5 | `tests/unit/cli/spill-demo-command.test.ts` | NEW | 83 (4 cases) | spill+list+hydrate round-trip / hydrated record matches payload / --batch-id preserved / empty session returns list of 1 |

### QA verify (PASS — clean, no process fixes needed)

- **AC-H1**: ✅ PASS — `registerSpillDemoCommand` exported (line 24); `_register.ts` line 73 (import) + line 141 (registration); `session-command.ts` line 29 (import) + line 244 (call inside `registerSessionCommand`); CLI smoke `peaks session spill-demo --help` shows new subcommand
- **AC-H2**: ✅ PASS — vitest 2 files / **11 tests / 0.374s** green (independent reproduction): spill-demo 4/4 + spillover-store 7/7
- **AC-H3**: ✅ PASS — typecheck `tsc -p tsconfig.json --noEmit` exit 0; `peaks release precheck --project . --json` overall=ok; red-line grep clean; `peaks audit red-lines` exit 0; RD state=implemented + QA state=verdict-issued (RD used `--allow-incomplete` per template-tracking pattern)
- **AC-H4**: ✅ PASS — SKILL.md has new "## 24h mode spill/hydrate (opt-in experimental, rid-032)" subsection at line 83 (10 lines); no new forbidden auto-compact prose introduced (matches at lines 79/128/145/149/152 are pre-existing red-line definition context)

### Backward-compat + scope verification (CRITICAL)

- `src/services/code/auto-compact-orchestrator.ts` D6.e branch **preserved verbatim** (0-byte diff vs HEAD `1f55eac9`)
- `src/services/24h-mode/decider.ts` byte-identical (no helper added)
- All prior rid files (rid-024 / rid-025 / rid-026 / rid-027 / rid-028 / rid-029 / rid-030 / rid-031 / rid-020b / rid-020a) byte-identical
- `package.json` / `tsconfig.json` / `pnpm-lock.yaml` byte-identical (no new deps)
- `git diff --stat HEAD` confirms only the 5 expected files (2 NEW + 3 EDIT), no collateral

### Caveats the user should know

- **Commit NOT performed by sub-agent** — peaks-loop red rule: orchestrator owns commit; user must authorize. Commit message MUST NOT contain `Co-Authored-By: Claude/Anthropic` trailer; the only valid trailer is the meta `Co-author: SquabbyZ sole author`.
- **`peaks session spill-demo` is opt-in experimental** — the LLM is not required to call it. Real production behavior remains governed by the existing D6.e deferral (preserved verbatim).
- **SKILL.md new subsection documents LLM-coordinated behavior** — does NOT instruct the user to type CLI commands (Human-NL-Choice-Only compliance).
- **The new `peaks session spill-demo` CLI** is a demo / testing tool. Future slices could:
  - Extend the payload schema with actual LLM turn context
  - Integrate spill() into the orchestrator entry point
  - Wire the LLM-side runbook to call spill() automatically on in-flight batch detection
  - Each of these is a separate rid

## 关联

- `.peaks/memory/2026-07-28-rid-031-dispatcher-deprecation-shipped.md` — prior ship (HEAD `1f55eac9`)
- `.peaks/memory/2026-07-28-24h-loop-audit.md` — A direction source; "需要完整 design slice, 大风险"
- `.peaks/memory/2026-07-28-24h-mode-p1-state-machine.md` — v2 re-revised proposal (LLM no-context mode design context)
- `.peaks/_runtime/2026-07-28-session-22381b/rd/requests/006-2026-07-28-rid-028-context-spillover-storage.md` — rid-028 RD handoff (provides spill/hydrate API)
- `.claude/plans/giggly-drifting-pizza.md` — full rid-032 plan
- `.peaks/_runtime/2026-07-28-session-22381b/rd/requests/010-2026-07-28-rid-032-turn-boundary.md` — RD handoff (state=implemented, with --allow-incomplete)
- `.peaks/_runtime/2026-07-28-session-22381b/qa/requests/013-2026-07-28-rid-032-turn-boundary.md` — QA verdict-issued
- `.peaks/_runtime/2026-07-28-session-22381b/qa/test-cases/2026-07-28-rid-032-turn-boundary.md` — test cases
- `.peaks/_runtime/2026-07-28-session-22381b/qa/test-reports/2026-07-28-rid-032-turn-boundary.md` — test report
- commit `<pending user authorization>` — ship commit (SquabbyZ sole-author, no AI co-author trailer)