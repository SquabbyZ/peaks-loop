---
name: plan-3a-baseline-repair-state
description: peaks-cli Plan 3a (baseline repair) interim state at context-compact time (2026-06-22). 5 commits landed (Tasks 1/2/3/3.5/4/4.5). Tasks 4.6 + 5 + Plan 3 still pending.
metadata:
  type: project
---

**Plan 3a ship state (Windows session, 2026-06-22, mid-compact):**

**Commits landed (in order):**
- `785c935` — docs(plan): Plan 3a document
- `a61255b` — test(companion): skip Unix-spawn tests on Windows (6 files, 124 skipped)
- `25c0ae8` — test(plan1-followup): align legacy request-init tests with one-axis --session-id required (7 files, 193 tests green)
- `a9c1909` — test(plan2-territory): align RD/QA + cross-platform + Windows path-separator collateral tests (4 files green)
- `09e768f` — fix(scan): orphan-service Windows path-separator (Task 3.5 inline — subagent surfaced real bug)
- `b67ca93` — test(integration): align workspace/standards/cli-bug tests (6 files, 51 pass + 2 skip + 1 todo)
- `dc6220b` — fix(test): --no-cache dead branch (Task 4.5 inline — subagent surfaced real bug)

**Pending work (post-compact resume order):**

1. **Task 4.6** — Fix `src/services/workspace/workspace-consolidate-service.ts:240` Win32 renameSync atomicity gap. Subagent surfaced: `renameSync(srcDir, existingFile)` silently replaces file with directory on Windows. Fix is `isDirectory` pre-check + rm. ~5 lines. Code unchanged.

2. **Task 4.5 cleanup** — `tests/unit/cli/options-no-flag-bug-class.test.ts` has `test.todo` at line 137 that should now be unblocked. Need to: (a) convert `test.todo` → real test, (b) uncomment the commented-out belt-and-suspenders test at lines 142-161. Both should now pass with the dc6220b fix.

3. **Plan 3a Task 5** — Run full `pnpm vitest run` + `pnpm tsc --noEmit` (only 2 pre-existing qa-reverify-strict-standards errors should remain). Mark `.peaks/memory/plan-3-blocker-baseline-rot.md` as resolved. Final commit + `git push origin main`.

4. **Plan 3** (peaks-rd strategic/tactical split) — Wait for Task 5 to ship. Then dispatch Task 1 (rd/types.ts).

**Pre-flight scan conflicts (carry-forward to Plan 3):**
- Plan 3 Task 7's "split run() into runStrategic+runTactical" — `rd-service.ts` only exports `createRdSwarmPlan`. User chose Option (a) at 2026-06-22: "保留 plan, 在 rd-service 加新 export". Implementer will add `runStrategicStage` + `runTacticalStage` as new exports, leave `createRdSwarmPlan` untouched.
- 601 → ~750 lines still under 800-line cap.
- peaks-solo stays the LLM orchestrator (RD sub-agent still produces rootCauseAnalysis, designRationale).

**Known carry-forward (post-Plan 3a ship):**
- 2 tsc errors in `tests/unit/rd/qa-reverify-strict-standards.test.ts` (hardcoded `/Users/yuanyuan/` path imports — pre-existing, never Windows-resolvable).
- Task 4 left 1 test as `.todo` (options-no-flag-bug-class line 137) + 1 commented-out belt-and-suspenders test — both unblocked after Task 4.5, will be cleaned up in Task 4.5-cleanup step above.

**Branch:** main, 7 commits ahead of origin/main (NOT pushed — Plan 3a Task 5 handles push).

**Why:** Plan 2 ship report "80/80 PASS" was a scoped subset; full suite had 88 failures across 26 files in 4 categories. Plan 3a fixes all categories plus 2 real production bugs surfaced during triage. Each category + each bug = own commit for review isolation.

**How to apply:** Always run `pnpm vitest run` (full suite, NOT scoped) before declaring a plan complete. The "scoped subset PASS" pattern hides cross-plan fallout. The static-scan test `tests/unit/cli/options-no-flag-bug-class.test.ts` and the orphan-service test are valuable tripwires — keep them green.