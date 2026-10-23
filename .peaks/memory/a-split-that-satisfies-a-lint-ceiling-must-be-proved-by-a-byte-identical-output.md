---
name: a-split-that-satisfies-a-lint-ceiling-must-be-proved-by-a-byte-identical-output
description: a split that satisfies a lint ceiling must be proved by a byte-identical output
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-22-session-b0e6e2/txt/handoff-t1-backlog-2026-10-23.md
---

Measured 2026-10-23 (T1 backlog campaign, `rid-t1-doctor-clean-row`). The parity check exceeded
`max-lines-per-function` (51 over 50, error) and `complexity` (11 over 10, warning). It was fixed by
splitting the comparison into three helpers, with no behaviour change intended. The proof that it WAS a
no-op was a byte-level diff of the doctor output before and after: added 0, removed 0, changed 0, row
order identical, envelope and `data` key sets identical, summary byte-identical, exit code identical.

**Why.** A passing test suite is not a proof of "nothing moved" — the suite may simply not cover the
rows that moved, and this check's own contract (four outcomes, two of them green and indistinguishable
by `(id, ok)`) is exactly the shape a test can miss. The lint ceiling was the only thing that would
have caught it, and it caught it as a FAILURE, not as a note.

**How to apply.** When a refactor is supposed to change nothing, diff the OBSERVABLE OUTPUT before and
after — field by field, order by order — and report the counts, rather than trusting the suite. Keep the
"before" capture from a state that is genuinely before: round 2's capture, not HEAD, when the change is
inside the slice being verified.
