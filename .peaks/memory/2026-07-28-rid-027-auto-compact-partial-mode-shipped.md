---
name: rid-027-auto-compact-partial-mode-shipped-2026-07-28
title: rid-027 auto-compact partial mode shipped (pending commit)
kind: project
description: rid-027 Phase 2C (C direction) ship — auto-compact mode table (standard 0.85/0.95 + partial 0.70/0.85) + 24h-mode auto-detection; closes audit's C direction (v2.13.0 zero-pause contract preserved)
metadata:
  type: project
  createdAt: 2026-07-28
  rid: 2026-07-28-rid-027-auto-compact-partial-mode
  shipCommit: <pending user authorization>
  companion: .peaks/memory/2026-07-28-24h-loop-audit.md (audit's C direction)
  priorContract: .peaks/memory/auto-compact-threshold-policy.md (v2.13.0 zero-pause contract preserved)
---

# rid-027 auto-compact partial mode — shipped

> **Status**: implementation + QA verify PASS-WITH-MINOR, pending user authorize commit (peaks-loop red rule).
> **Trigger**: user 2026-07-28 显式指令 "按顺序全部完成"; audit's C direction: "auto-compact 阈值分模式 (24h 模式 0.70 / 0.85 partial)" with v2.13.0 zero-pause contract caveat.
> **scope**: feature — 5 EDIT + 2 NEW source/test files. Adds mode-aware auto-compact thresholds + 24h-mode auto-detection (`getAutoCompactMode` helper that reads `24h-mode/store.js`).

## Why

24h mode runs at higher concurrency / longer wall-clock time. The default 0.85/0.95 thresholds fire late — by the time they fire, the LLM has accumulated lots of context that must be compacted at once, which is slow and disruptive. Per audit's C direction: "auto-compact 阈值分模式 (24h 模式 0.70 / 0.85 partial)" — earlier compaction cadence (0.70 instead of 0.85) keeps context leaner and reduces the size of each compact event.

The `partial` mode is automatically selected when `peaks session 24h-mode` is `24H_ACTIVE` (read via `resolveAutoCompactMode` in orchestrator + `getAutoCompactMode` helper in `decider.ts`). The CLI `--mode <mode>` flag overrides the auto-detection.

## How to apply

### 7-file diff scope (5 EDIT + 2 NEW)

| # | File | Action | LOC | Description |
|---|---|---|---|---|
| 1 | `src/services/code/auto-compact-modes.ts` | NEW | 41 | `AutoCompactMode` enum (`'standard' \| 'partial'`) + `AUTO_COMPACT_THRESHOLDS` table (standard 0.85/0.95; partial 0.70/0.85) + 5 helpers (`thresholdFor` / `isValidMode` / `describeMode` / `isPartialModeEligible`) |
| 2 | `src/services/code/auto-compact-orchestrator.ts` | EDIT | 470 (was 428, +42) | Added `mode?: AutoCompactMode` field to `RunAutoCompactInput`; updated `evaluateCompactTrigger(ratio, mode)` signature; added `resolveAutoCompactMode(projectRoot, sessionId)` helper that reads `24h-mode/store.js` and returns `'partial'` when `state === '24H_ACTIVE'` else `'standard'` |
| 3 | `src/cli/commands/code-runtime-commands.ts` | EDIT | 476 (was 460, +16) | Added `--mode <mode>` flag to `auto-compact` sub-command (default `'standard'`, validates via `isValidMode`); help text mentions mode |
| 4 | `src/services/24h-mode/decider.ts` | EDIT | 200 (was 183, +17) | Added `getAutoCompactMode(projectRoot, sessionId): AutoCompactMode` helper that reads 24h-mode state and returns `'partial'` when 24H_ACTIVE else `'standard'` |
| 5 | `src/services/context/auto-compact-types.ts` | EDIT | 146 (was 136, +10) | Added `mode` field to `AutoCompactResult.data` discriminated union (surgical 4-line addition for TypeScript soundness; not in original plan but required for typecheck to pass) |
| 6 | `tests/unit/services/code/auto-compact-modes.test.ts` | NEW | 53 (6 cases) | thresholdFor / isValidMode / describeMode / isPartialModeEligible tests |
| 7 | `tests/unit/context/auto-compact-main-target.test.ts` | EDIT | 203 (was ~120, +82) | Extended with 6 partial-mode cases (0.72 pre-compact, 0.86 red-line, 0.86 standard pre-compact, 0.96 standard red-line, 0.50 default skip, etc.) |

### QA verify (PASS-WITH-MINOR)

- **AC-C1**: ✅ PASS — `auto-compact-modes.ts` exports `AutoCompactMode` + `AUTO_COMPACT_THRESHOLDS` + 5 helpers confirmed; orchestrator accepts `mode?: AutoCompactMode`; `code-runtime-commands.ts` `--mode <mode>` flag registered; `decider.ts` `getAutoCompactMode` helper at line 193; `auto-compact-types.ts` updated for type soundness
- **AC-C2**: ✅ PASS — 3 vitest files / **36 tests all green in 13.78s** (independent reproduction): `auto-compact-modes.test.ts` 6/6 + `auto-compact-main-target.test.ts` 14/14 + `24h-mode/decider.test.ts` 18/18. Pre-existing baseline failure count in `compact-command-references.test.ts` is exactly 6 (not regressed).
- **AC-C3**: ✅ PASS — typecheck exit 0; `peaks release precheck --project . --json` overall=ok; 5 forbidden auto-compact prose strings EXIT=1 clean on all 7 files; `peaks audit red-lines` exit 0 (preserved pre-lint cleanliness, 114 red-lines / 0 violations); `peaks request transition rid-027-... --state implemented` WITHOUT `--allow-incomplete` SUCCESS

### Minor findings (non-blocking, all benign)

1. **`auto-compact-orchestrator.ts` 1 occurrence of "run auto-compact"** in benign error message (`No active session; cannot run auto-compact. Run \`peaks workspace init\` first.`). Not a forbidden threshold-policy violation — UX error, not prose about user responsibilities.
2. **QA test path was wrong** — actual path `tests/unit/24h-mode/decider.test.ts` (not `tests/unit/services/24h-mode/decider.test.ts` as pre-flight stated). Code pre-flight path was stale; test still passes when run with correct path.
3. **Pre-existing baseline failure**: `compact-command-references.test.ts` has 6 failures due to `auto-compact-dispatcher.ts:31` still importing `node:child_process` — **outside rid-027 scope**; documented in dispatch file as TODO.

## Caveats the user should know

- **Commit NOT performed by sub-agent** — peaks-loop red rule: orchestrator owns commit; user must authorize. Commit message MUST NOT contain `Co-Authored-By: Claude/Anthropic` trailer; the only valid trailer is the meta `Co-author: SquabbyZ sole author`.
- **`auto-compact-types.ts` was unlisted in original plan** — added 10 lines surgically because the `AutoCompactResult.data` discriminated union required a `mode` field for TypeScript soundness. Same surgical pattern as rid-025 (peer surfaced `auto-compact-reader.ts` duplicate semicolon fix during QA round).
- **`partial` mode partial-compaction behavior is future work**: this slice implements the mode table + threshold logic + decision logging. The actual "drop low-priority context layers" execution is a follow-up rid-030 candidate (logged but not executed; the `partial` mode currently fires the same full compact as standard mode at its own threshold).
- **`auto-compact-dispatcher.ts` `node:child_process` import is a known TODO** — pre-existing, not a regression introduced by this slice. The 6 baseline failures in `compact-command-references.test.ts` will need a separate rid to retire (e.g., rid-031 dispatcher-deprecation).
- **Pre-lint verification**: `peaks audit red-lines --project . --json` exit 0 / 114 red-lines / 0 violations, both BEFORE and AFTER this slice. The v2.13.0 zero-pause contract prose is preserved.

## 关联

- `.peaks/memory/2026-07-28-24h-loop-audit.md` — C direction source
- `.peaks/memory/auto-compact-threshold-policy.md` — v2.13.0 zero-pause contract preserved
- `.peaks/memory/2026-07-28-rid-026-monotonic-jsonl-store-shipped.md` — prior ship
- `.peaks/memory/2026-07-28-rid-025-heartbeat-watch-and-ban-shipped.md` — prior ship
- `.claude/plans/giggly-drifting-pizza.md` — full rid-027 plan
- `.peaks/_runtime/2026-07-28-session-22381b/rd/requests/005-2026-07-28-rid-027-auto-compact-partial-mode.md` — RD handoff (state=implemented)
- `.peaks/_runtime/2026-07-28-session-22381b/qa/requests/005-2026-07-28-rid-027-auto-compact-partial-mode-verify.md` — QA verify (PASS-WITH-MINOR)
- commit `<pending user authorization>` — ship commit (SquabbyZ sole-author, no AI co-author trailer)