---
name: touching-a-shared-path-means-running-that-paths-existing-tests
description: A sub-agent's scoped tests scoped to its OWN directory hid a regression in a pre-existing test on the shared path it had changed — the fix is to name the shared path's existing test files in the brief.
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-20-session-f7f45b/rd/requests/2026-10-21-race-batch-mode.md
---

The race-batch-mode Task 8 changed `src/services/code/auto-compact-decision.ts` and
`auto-compact-orchestrator.ts` — the **shared** compaction path every lane walks through — and its
scoped tests were green because they ran `tests/unit/services/`.

The full suite then failed: `tests/unit/code/compact-swallow-invariant.test.ts`, a test that
**predates the feature**, failed because the new batch lookup, called from `openRun` on **every**
auto-compact run, threw on a session id the compaction path accepts. The batch code's
`listBatchIds` called `getSessionDir(...)` *outside* its `try` block; `getSessionDir` deliberately
throws for a session id that is not one path segment. The function's own comment already said
*"A session with no batch directory has no batches. That is an answer, not a failure."* — the code
did not honour it.

**The brief said "the no-batch path must be byte-identical to today". The agent asserted it; nothing
verified it.** The scoped test directory was chosen from the files the agent had written, and the
shared path's tests live somewhere else.

**The rule: when a slice touches a shared path, the brief must NAME that path's existing test
files**, not just "run scoped tests". For this repo:

| the slice touches | also run |
|---|---|
| `src/services/code/auto-compact-*` | `tests/unit/code/`, `tests/unit/services/code/` |
| anything under `src/services/lint/` | `tests/unit/lint/`, `tests/unit/standards/` |
| `src/cli/commands/core/skill-context-verdict.ts` | `tests/unit/cli/skill-presence-loop-hygiene.test.ts` |

**A green suite scoped to your own directory is evidence about your own code only.** The pre-existing
tests on the path you changed are the ones that know what the path used to do.

The shared-path lesson generalises the same way as
[[a-guard-that-reads-the-thing-it-guards-is-not-a-guard]]: the regression lived in the *interaction*
between the new call and the old contract, and no test that only exercised the new code could see it.
