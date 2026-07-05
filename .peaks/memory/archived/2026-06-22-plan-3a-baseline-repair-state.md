**Plan 3a ship state (Windows session, 2026-06-22, mid-compact):**
archived: 2026-06-29
reason: v2.16.0-alpha change-id axis scope reduction
status: archived

**Commits landed (in order):**
- `785c935` — docs(plan): Plan 3a document
- `a61255b` — test(companion): skip Unix-spawn tests on Windows (6 files, 124 skipped)
- `25c0ae8` — test(plan1-followup): align legacy request-init tests with one-axis --session-id required (7 files, 193 tests green)
- `a9c1909` — test(plan2-territory): align RD/QA + cross-platform + Windows path-separator collateral tests (4 files green)
- `09e768f` — fix(scan): orphan-service Windows path-separator (Task 3.5 inline — subagent surfaced real bug)
- `b67ca93` — test(integration): align workspace/standards/cli-bug tests (6 files, 51 pass + 2 skip + 1 todo)
- `dc6220b` — fix(test): --no-cache dead branch (Task 4.5 inline — subagent surfaced real bug)
- `356029e` — fix(workspace): reject file-shaped collision on consolidate (Task 4.6)
- `12208f5` — test(cli): enable slice #014 belt-and-suspenders scan (Task 4.5-cleanup)
- `c096e9d` — fix(test): Task 5 — invert --no-cache logic + POSIX-normalize checkpoint paths
- `fd1627f` — fix(test): qa-reverify — relative import + POSIX path in diagnostic (Task 5)

**Pending work (post-compact resume order):**

1. **Pre-Plan-3 cleanup** — `tests/integration/workspace-clean-cli.test.ts` has 4 full-suite flakes that pass in isolation. They share `peaks workspace clean --runtime` which spawns `node bin/peaks.js` → `dist/src/cli/index.js`. The most likely root cause is some earlier test in the singleFork vitest worker leaking CWD or `.peaks/_runtime/<sid>/` state, causing `resolveCanonicalProjectRoot` to find a stale project root. To investigate: bisect by running `pnpm vitest run tests/integration/workspace-clean-cli.test.ts` alongside one candidate test file at a time (suspects: any test that uses `process.chdir` without restoring in afterEach, or any test that writes under `C:\Users\smallMark\Desktop\peaks-loop\.peaks\_runtime\`). When found, fix in a separate commit before starting Plan 3.

2. **Plan 3a Task 5 ship** — `git push origin main` (11 commits ahead). Re-run full suite + tsc after the workspace-clean-cli fix to confirm 0 failures + 0 tsc errors.

3. **Plan 3** (peaks-rd strategic/tactical split) — Wait for Plan 3a to ship clean. Then dispatch Task 1 (rd/types.ts).

**Pre-flight scan conflicts (carry-forward to Plan 3):**
- Plan 3 Task 7's "split run() into runStrategic+runTactical" — `rd-service.ts` only exports `createRdSwarmPlan`. User chose Option (a) at 2026-06-22: "保留 plan, 在 rd-service 加新 export". Implementer will add `runStrategicStage` + `runTacticalStage` as new exports, leave `createRdSwarmPlan` untouched.
- 601 → ~750 lines still under 800-line cap.
- peaks-code stays the LLM orchestrator (RD sub-agent still produces rootCauseAnalysis, designRationale).

**Branch:** main, 11 commits ahead of origin/main (NOT pushed — Plan 3a Task 5 handles push).

**Why:** Plan 2 ship report "80/80 PASS" was a scoped subset; full suite had 88 failures across 26 files in 4 categories. Plan 3a fixes all categories plus 4 real production bugs surfaced during triage (orphan-service Win32 path, --no-cache dead branch, workspace-consolidate file-collision, --no-cache inverted logic). Each category + each bug = own commit for review isolation.

**How to apply:** Always run `pnpm vitest run` (full suite, NOT scoped) before declaring a plan complete. The "scoped subset PASS" pattern hides cross-plan fallout. The static-scan test `tests/unit/cli/options-no-flag-bug-class.test.ts` and the orphan-service test are valuable tripwires — keep them green.