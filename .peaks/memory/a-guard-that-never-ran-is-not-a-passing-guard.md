---
name: a-guard-that-never-ran-is-not-a-passing-guard
description: A guard that never ran is not a passing guard
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-10-session-062f74/txt/handoff.md
---

A cross-cutting structural guard stayed red through three batches and two commits of this round.
`tests/unit/runtime/no-runtime-input-guard-rule-d.test.ts` asserts that an id joined after a
`_runtime` path segment carries a guard in the SAME file. Batch 1 (`339746bb`) moved the
`isUnsafePathInput(terminalId)` guard into `playwright-session-store.ts` while the join it protects
stayed behind in `playwright-commands.ts` — a genuine structural break of the rule. Baches 1, 2 and
3 were each verified with area-scoped suites, and nothing that ran was reading
`tests/unit/runtime/`. The guard lives in a directory no area-scoped run reaches, so it was only
ever visible to a full-suite run. The batch that measured the offender even concluded "predates
this batch" — true of batch 3, false of the round, because it measured the commit and never asked
who authored it. Repair: `04c04aeb`, proven by AC4's full-suite run
(`427 files / 4487 passed / 3 skipped / EXIT=0`), not by a list of relevant tests.
