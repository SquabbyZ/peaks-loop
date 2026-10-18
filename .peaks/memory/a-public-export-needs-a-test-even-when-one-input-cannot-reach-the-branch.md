---
name: a-public-export-needs-a-test-even-when-one-input-cannot-reach-the-branch
description: a-public-export-needs-a-test-even-when-one-input-cannot-reach-the-branch
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-memory-tests.md
---

The item was titled "unreachable for object input", but the corrected measurement is the opposite: the
predicate recurses into object values, so `{body:{token:'x'}}` DOES reach the branch; only a plain
STRING skips it. The branch is real, `assertSafeMemory` is a public export, and zero tests covered it.
Deleting it would have weakened detection.

**Why:** "unreachable" was a claim about one input shape, not about the export. A public function's
branch needs a test even if the caller you were thinking of cannot hit it.

**How to apply:** pin the public export's behavior for every input shape the branch distinguishes
(object vs string here), and do not delete a defensive branch because a narrow reading calls it
unreachable.
