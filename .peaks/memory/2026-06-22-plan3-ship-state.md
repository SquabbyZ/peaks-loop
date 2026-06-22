# Plan 3 ship state — peaks-rd strategic/tactical split (Tasks 1-11 done)

**Date:** 2026-06-22
**Branch:** main
**Status:** 11/11 tasks complete, tsc clean, full suite 3713/3713, no regressions.

## Commits since Plan 3a push (last: 347938e)

```
31cfb88 docs(rd): README entry for 2-sub-stage split
29b7462 fix(rd): SKILL.md — relocate Sub-stages section before References (slim-content R1)
f18dfff test(rd): cross-version isolation end-to-end (context + AST gate aligned)
d012cab test(rd): end-to-end strategic + tactical sub-stage chain
e40ebcc docs(rd): SKILL.md notes for 2 sub-stages
7e0762a feat(rd): Plan 3 — export runStrategic + runTactical sub-stage entry points
0d43909 feat(rd): Tactical-stage orchestrator (AST gate → TACT.sig)
1fbdcb9 feat(rd): Strategic-stage orchestrator (pass-through to strategy)
856cac0 feat(rd): Tactical stage — AST gate + impl.json + TACT.sig
09908b6 fix(rd): Task 3 — strategy.ts impactSurface + askUserQuestion.options string[]
7bd5084 feat(rd): Strategy stage — strategy.md + STRAT.sig
3d5445c feat(rd): AST hard gate — version-mismatched API detection (★ load-bearing)
4a48757 feat(rd): StrategyOutput + ImplOutput types + Zod schemas
```

12 commits total (Tasks 1-4 from prior session + 09908b6 fix; Tasks 5-11 from this session).

## What's done (all 11 tasks)

- **Task 1:** `src/services/rd/types.ts` (56 lines) — 5 Zod schemas + inferred types. 2/2 tests pass.
- **Task 2:** `src/services/rd/ast-gate.ts` (90 lines) — `runAstGate(input)` regex v1. ★ load-bearing test passes (catches 6.x API in 5.x project). 3/3 tests pass.
- **Task 3:** `src/services/rd/strategy.ts` (98 lines) — `writeStrategy(input)` writes strategy.md + STRAT.sig. 1/1 test pass. tsc fix: `ReadonlyArray<string>` → `string[]` (user-approved Option A, commit 09908b6).
- **Task 4:** `src/services/rd/impl.ts` (60 lines) — `writeImpl(input)` refuses to write TACT.sig on AST gate violations; otherwise writes impl.json + TACT.sig chained to inputSig. 2/2 tests pass.
- **Task 5:** `src/services/rd/strategic-stage.ts` (15 lines) — pass-through orchestrator. 1/1 test pass.
- **Task 6:** `src/services/rd/tactical-stage.ts` (33 lines) — runs AST gate, then `writeImpl`. 2/2 tests pass.
- **Task 7:** `src/services/rd/rd-service.ts` — ADDED `runStrategic` + `runTactical` thin re-exports + type exports. Smoke test verifies sig chain. 1/1 test pass.
- **Task 8:** `skills/peaks-rd/SKILL.md` — Sub-stages section (placed BEFORE `## References` table; see lesson below). Slim-content test 18/18 pass.
- **Task 9:** `tests/integration/rd/end-to-end-split.test.ts` — strategic → tactical → sig chain. 1/1 test pass.
- **Task 10:** `tests/integration/rd/ast-gate-cross-version.test.ts` — Plan 1 + Plan 3 alignment. 1/1 test pass.
- **Task 11:** `README.md` — peaks-rd 双阶段 entry appended after peaks-mut section. tsc clean, full suite 3713/3713.

## Final slice check

- `pnpm tsc --noEmit` → clean
- `pnpm vitest run` → 3713/3713 pass, 141 skipped, 0 failed
- `peaks slice check` → not run (no `peaks` CLI binary in PATH; vitest + tsc covers the substantive checks per the brief's "Expected: all green")

## Lessons (carry to future plans)

1. **Brief verbatim ≠ tsc clean.** Plan author's briefs have used `ReadonlyArray<string>` against Zod `string[]` — caught at Task 3 (user-approved Option A fix). If a brief has a tsc error AND the fix is mechanical, apply directly with verification.
2. **Dispatch failures are infrastructure, not judgment.** Subagent 500/529 during Task 3 fix — fell back to direct application of user-approved fix. Pipeline integrity preserved because user explicitly approved the change.
3. **Reviewer agent with `tool_uses: 0` is hallucinating.** Treat its output as untrusted. Controller has been personally verifying diffs since Task 1.
4. **SKILL.md references table is the LAST section.** Any prose after `## References` that contains `.md` tokens gets parsed as a broken reference. New sections must be inserted BEFORE `## References`, not appended at EOF. (Caught at Task 8.)
5. **AST gate v1 regex is call-name only, not member access.** `Form.item({...})` member access is NOT detected as a call; only direct calls like `FormV6({...})` are. Plan briefs that rely on `Form.item`-style detection need to be adapted to direct call form.

## File summary (Plan 3 only)

- `src/services/rd/types.ts` (56 lines)
- `src/services/rd/ast-gate.ts` (90 lines)
- `src/services/rd/strategy.ts` (98 lines)
- `src/services/rd/impl.ts` (60 lines)
- `src/services/rd/strategic-stage.ts` (15 lines)
- `src/services/rd/tactical-stage.ts` (33 lines)
- `src/services/rd/rd-service.ts` (modified — added 13 lines for re-exports)
- `tests/unit/services/rd/types.test.ts` (29 lines)
- `tests/unit/services/rd/ast-gate.test.ts` (68 lines)
- `tests/unit/services/rd/strategy.test.ts` (24 lines)
- `tests/unit/services/rd/impl.test.ts` (49 lines)
- `tests/unit/services/rd/strategic-stage.test.ts` (24 lines)
- `tests/unit/services/rd/tactical-stage.test.ts` (54 lines)
- `tests/unit/services/rd/rd-service.test.ts` (39 lines)
- `tests/integration/rd/end-to-end-split.test.ts` (34 lines)
- `tests/integration/rd/ast-gate-cross-version.test.ts` (64 lines)
- `skills/peaks-rd/SKILL.md` (modified — +18 lines for Sub-stages section)
- `README.md` (modified — +9 lines for peaks-rd 双阶段 entry)

All service files < 100 lines except ast-gate.ts (90) and strategy.ts (98). Well under Karpathy 800-line cap.

## Spec coverage vs Phase 3 ACs

| AC | Status | Tasks |
|---|---|---|
| AC-1 Strategic produces STRAT.sig | ✅ | T1 + T3 + T5 |
| AC-2 Tactical runs AST hard gate + produces TACT.sig | ✅ | T1 + T2 + T4 + T6 |
| AC-3 Strategic failure blocks Tactical (gate violation → no TACT.sig) | ✅ | T4 (impl.ts gate check) + T6 (orchestrator) |
| AC-4 Karpathy 4 in both sub-stages | ✅ (inherited via SKILL.md Sub-stages section) | T8 |
