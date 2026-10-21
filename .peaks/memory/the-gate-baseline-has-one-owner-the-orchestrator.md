---
name: the-gate-baseline-has-one-owner-the-orchestrator
description: The ratchet baseline is stale the moment a slice adds an in-scope file, and only the orchestrator may regenerate it — a sub-agent that regenerates it in its own worktree collides at merge time.
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-20-session-f7f45b/rd/requests/2026-10-21-race-batch-mode.md
---

Three separate slices in the race-batch-mode run (Task 4, Task 1, Task 2) each added in-scope files
without regenerating `.peaks/lint/gate-baseline.json`, and each time three baseline tests went red
(`file-size-cap` F4, `scope-shadow-coverage` control c, `silent-warning-scope-leg` A7) with the
same message: the recorded population disagrees with the scope the gate actually lints.

**Two rules, and they are separate.**

**1. The baseline is stale whenever a slice adds an in-scope file — and only the orchestrator may
regenerate it.** The baseline is a *ratchet artifact*; a sub-agent that regenerates it inside its own
worktree produces a version that collides with the orchestrator's at merge time. The fix is to say so
in the dispatch brief ("rebase; do not regenerate the baseline — it is the parent's"), and to expect
the red three and treat them as the parent's work, not a defect in the slice. A sub-agent that
*reports* the three red with the cause named — "no `files[]` row for `src/services/batch/batch-verify.ts`,
`scope grew: 1330 -> 1331`" — is doing exactly right.

**2. "Do not change the gate baseline" is not "never touch the file".** The rule forbids *raising a
ceiling to turn a red gate green*. It does not forbid refreshing a stale census. The discriminator is
the line the generator prints:

```
monotonicity: every ceiling held — nothing rose and nothing dropped; every ceiling may only go DOWN.
```

That line means no ceiling moved, so committing the refreshed baseline is honest. Anything else —
a rise in `fileSizeOverCap`, `fileSizeExcessLines`, `eslintFindings`, `silentWarningEmptyCatch` — is
a real regression, and the fix is to change the code, not the number. See
[[a-ceiling-row-is-born-measured-before-it-is-committed]] for the sibling case (a *new* ceiling row
born measured-before-committed) and [[the-gate-does-not-lint-tests-so-a-new-test-file-is-ungated]]
for the other thing a baseline refresh keeps revealing.
