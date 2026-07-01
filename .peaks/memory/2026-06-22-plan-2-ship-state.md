---
name: plan-2-ship-state
description: peaks-loop Plan 2 (peaks-mut, RID 2026-06-21-mutation-test-quality) ship state on 2026-06-22. 12 commits on main, 80/80 tests PASS, Opus 4.8 final review ship-with-notes. Carry-forward for Plan 3.
metadata:
  type: project
---

**Plan 2 ship state (Windows session, 2026-06-22):**
- RID: 2026-06-21-mutation-test-quality
- Branch: main (Plan 1-4 runs on main, established v3.0 pattern)
- Range: `81f00ce..e6f0373` (12 commits)
- Working tree: CLEAN
- Tests: 80/80 PASS across 23 test files (~2.30s)
- Final review: Opus 4.8, ship-with-notes (0 CRITICAL/HIGH; MEDIUM-1/2 fixed in `e6f0373`)
- Not pushed to origin (33 commits total ahead: 21 from Plan 1 + 12 from Plan 2)

**Plan 2 footprint:**
- 27 files, +3840 / -30 lines
- `src/services/mut/` — types, assert-scanner, mut-runner, production-stryker, report-builder, report-loader, thresholds, index
- `src/cli/commands/mut-commands.ts` — 4 subcommands (run, mutants, asserts, report)
- `src/skills/peaks-mut/SKILL.md` — 196 lines
- `src/services/qa/qa-service.ts` (extended) + `src/cli/commands/qa-commands.ts` — consumes MUT.sig
- Tests: `tests/unit/services/mut/{types,assert-scanner,mut-runner,thresholds,report-builder,report-loader}.test.ts`, `tests/unit/cli/commands/mut-commands.test.ts`, `tests/integration/mut/end-to-end.test.ts`

**Plan 2 commit log:**
```
e6f0373 fix(mut): address MEDIUM-1 and MEDIUM-2 from final review
e669f91 docs(mut): add peaks-mut README section + package scripts
86836a5 test(mut): end-to-end run produces valid mut-report.json
3925397 fix(test): reset process.exitCode in request-commands test helper
cad634a feat(qa): consume MUT.sig — surface test-quality failures
46c5f84 docs(skills): add peaks-mut SKILL.md
f80f044 feat(mut): peaks mut CLI commands (run|mutants|asserts|report)
5898cf4 feat(mut): Thresholds + ReportBuilder (MUT.sig chain, followup derivation)
4e83159 feat(mut): MutRunner (Stryker wrapper + production invoker)
543b925 feat(mut): AssertScanner with 5 weak-pattern detectors (regex v1)
cfdd727 feat(mut): MutReportJson types + Zod schema (v1.0)
cf4480e chore(mut): add Stryker dependencies + scaffold directories
```

**Key architectural decisions (locked):**
1. **One-axis envelope**: `.peaks/_runtime/<id>/` 完全禁止;所有 envelope 走 `.peaks/_runtime/<sid>/` (CLI hotfix 81f00ce)
2. **MUT.sig**: recursive key canonicalization in `report-builder.ts` (not top-level-only as plan suggested). Deterministic across runs.
3. **AssertScanner**: regex v1 (5 patterns: toBeDefined, toBeTruthy, toEqual-self, expect-anything, toBe-self) — plan explicitly defers AST migration to a follow-up
4. **MutRunner**: Stryker 8 programmatic API (lazy-imported in production-stryker.ts), not subprocess
5. **peaks-qa integration**: `loadMutReport()` returns null on ENOENT/malformed → gate is `skipped`, not failed. Only `thresholds.passed === false` triggers exit code 2.

**Carry-forward to Plan 3 (peaks-rd strategic/tactical split):**
- 2 LOW findings deferred: regex v1 fragility (member expressions); README design-spec link broken
- 2 pre-existing TSC errors in `tests/unit/rd/qa-reverify-strict-standards.test.ts` (v2.8.0 merge regression; out of scope)
- 47 pre-existing Windows-env vitest failures in `tests/unit/companion/*`
- Stryker 8 real-run shape unexercised in unit tests (Task 9 e2e mocks it)

**Why:** Why I should remember this: Plan 2 is the second of 4 v3.0 plans. Plan 3 (`2026-06-21-rd-strategic-tactical-split.md`) and Plan 4 (`2026-06-21-state-lock-acceptance.md`) follow. The branch is `main`, working tree clean, no push yet — user decision pending.

**How to apply:** When resuming Plan 3, read this memory FIRST, then `git log --oneline 81f00ce..HEAD` to verify the 12 commits are intact, then read `docs/superpowers/plans/2026-06-21-rd-strategic-tactical-split.md`. The CLI one-axis rule and the `process.exitCode` reset pattern (per `3925397`) MUST be respected by any new test helper code.
