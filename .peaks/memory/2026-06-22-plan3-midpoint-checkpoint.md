# Plan 3 midpoint checkpoint (Tasks 1-4 done, 7 remaining)

**Date:** 2026-06-22
**Branch:** main
**Status:** 4/11 tasks complete, tsc clean, full suite 3705/3705, no regressions.

## Commits since Plan 3a push (last: 347938e)

```
856cac0 feat(rd): Tactical stage — AST gate + impl.json + TACT.sig
09908b6 fix(rd): Task 3 — strategy.ts impactSurface + askUserQuestion.options string[]
7bd5084 feat(rd): Strategy stage — strategy.md + STRAT.sig
3d5445c feat(rd): AST hard gate — version-mismatched API detection (★ load-bearing)
4a48757 feat(rd): StrategyOutput + ImplOutput types + Zod schemas
```

## What's done

- **Task 1:** `src/services/rd/types.ts` — 5 Zod schemas (StrategyOutput, ImplOutput, AstViolation, AstGateResult, ExternalApiCall) + inferred types. 2/2 tests pass.
- **Task 2:** `src/services/rd/ast-gate.ts` — `runAstGate(input)` regex-based v1. ★ load-bearing test passes (catches 6.x API in 5.x project). 3/3 tests pass. 3704/3704 full suite.
- **Task 3:** `src/services/rd/strategy.ts` — `writeStrategy(input)` writes strategy.md + STRAT.sig. 1/1 test pass. **tsc fix applied**: `ReadonlyArray<string>` → `string[]` for `impactSurface` and `askUserQuestion.options` (Option A, user-approved).
- **Task 4:** `src/services/rd/impl.ts` — `writeImpl(input)` refuses to write TACT.sig if AST gate has violations; otherwise writes impl.json + TACT.sig chained to inputSig (STRAT.sig). 2/2 tests pass. Brief's preemptive spread (`[...input.changedFiles]`) avoided the Task 3 readonly issue.

## What's pending (7 tasks)

- **Task 5:** `src/services/rd/strategic-stage.ts` — pass-through to `writeStrategy` for consistent public surface.
- **Task 6:** `src/services/rd/tactical-stage.ts` — runs `runAstGate` then `writeImpl` (orchestrator).
- **Task 7:** Add new exports `runStrategic` + `runTactical` to `src/services/rd/rd-service.ts`. **User decision (2026-06-22):** do NOT refactor existing `runRd` — ADD new exports only.
- **Task 8:** Append sub-stage docs to `src/skills/peaks-rd/SKILL.md`.
- **Task 9:** `tests/integration/rd/end-to-end-split.test.ts` — strategic → tactical → sig chain.
- **Task 10:** `tests/integration/rd/ast-gate-cross-version.test.ts` — Plan 1 + Plan 3 alignment.
- **Task 11:** Slice check (`tsc + vitest + peaks slice check`) + README entry.

## Resumed-from-compact protocol

1. **Trust the ledger and git log over recollection.** The commits above exist; don't re-dispatch.
2. **Resume at Task 5.** Task 5 brief at `.git/sdd/task-5-brief.md` (already extracted during prior session). Report path: `.git/sdd/plan3-task-5-report.md`.
3. **Apply Task 3 lesson preemptively:** if any brief uses `ReadonlyArray<string>` and the Zod output is `string[]`, change the input to `string[]` (Option A, user-approved). Briefs in Tasks 5-6 are simple orchestrators that pass-through; should be unaffected.
4. **Reviewer agent quality is variable:** Task 1 reviewer hallucinated (`tool_uses: 0`); Task 2 reviewer actually read the diff (3 tool uses). For Tasks 5+ the controller has been doing personal verification of the diff (read + check) — continue this practice if reviewer outputs are suspect.
5. **If subagent dispatch hits 500/529 gateway errors,** apply the user-approved surgical fix directly with verification. Document in the report file.
6. **User hard rules (still in force):**
   - 完全禁止 `.peaks/<change-id>` 根目录 — never `peaks workspace init --change-id <id>`.
   - "不要留问题" — every commit must leave the suite green.

## Files created so far (Plan 3 only)

- `src/services/rd/types.ts` (56 lines)
- `src/services/rd/ast-gate.ts` (90 lines)
- `src/services/rd/strategy.ts` (98 lines)
- `src/services/rd/impl.ts` (60 lines)
- `tests/unit/services/rd/types.test.ts` (29 lines)
- `tests/unit/services/rd/ast-gate.test.ts` (68 lines)
- `tests/unit/services/rd/strategy.test.ts` (24 lines)
- `tests/unit/services/rd/impl.test.ts` (49 lines)

All files < 100 lines except ast-gate.ts (90) and strategy.ts (98). Well under Karpathy 800-line cap.

## Lessons (carry to Tasks 5-11)

1. **Brief verbatim ≠ tsc clean.** Plan author's briefs have used `ReadonlyArray<string>` against Zod `string[]` — caught at Task 3. If a brief has a tsc error AND the fix is mechanical (e.g. change input to `string[]` or use spread), apply directly with verification.
2. **Dispatch failures are infrastructure, not judgment.** Three subagent dispatches failed with 500/529 during Task 3 fix — fell back to direct application of user-approved 1-character fix. Pipeline integrity preserved because the user explicitly approved the change.
3. **Reviewer agent with `tool_uses: 0` is hallucinating.** Treat its output as untrusted. Controller has been personally verifying diffs since Task 1.
