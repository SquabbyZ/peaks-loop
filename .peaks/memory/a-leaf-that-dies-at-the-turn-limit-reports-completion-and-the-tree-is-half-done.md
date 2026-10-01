---
name: a-leaf-that-dies-at-the-turn-limit-reports-completion-and-the-tree-is-half-done
description: a leaf that dies at the turn limit reports completion, and the tree is half-done
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-29-session-b7cf21/txt/handoff.md
---

Two dispatches in one rid ended with `Reached the maximum turn limit (150). The task may be
incomplete.` and a "partial result" that read like a status line (`Agent execution completed.` /
`Now the tests. First the census-guard library:`). Neither was a lie about the code, but both left
the tree mid-work: the first died after writing 414 insertions and its envelope, the second after
704 insertions and **no** envelope, with the full unit suite at 3610 passed / 1 failed.

The failure is invisible from the report and visible from the tree, so the check is the tree:
`git status --short`, `git diff --stat`, and whether the promised envelope exists. What the
second leaf also did is worth keeping: it **overturned the diagnosis handed to it** — the
orchestrator had said the new fail-closed refusal printed nothing before exiting, and the real
cause was that the shared guard module was imported as a sibling, so the parity test's scratch copy
of the gate in `.tmp/` died at import with `ERR_MODULE_NOT_FOUND`. The parity test was untouched
and its control arm went red on its own terms (1386 measured against the oracle's 1429).

**How to apply:** after any leaf, re-measure before believing: run the suites yourself, serially,
and report the exit codes you got. Expect a mid-work death to leave working code with no
documentation, so the next dispatch must state what is verified and inherit only the rest. A
repair cycle's first job is to falsify the brief it was given, including the orchestrator's
diagnosis in it.
