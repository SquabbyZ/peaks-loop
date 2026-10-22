---
name: a-claim-that-nothing-moved-the-other-way-is-a-statement-about-the-rows-measured
description: A claim that nothing moved the other way is a statement about the rows measured
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-22-session-b0e6e2/txt/handoff-round2.md
---

**"Nothing moved the other way" is a statement about the ROWS MEASURED, not about the space.**

Measured twice in one slice (2026-10-22, the `§18.1` Code-Gate work), and both times the claim
was scoped to a matrix that could not see the case that mattered.

- The orchestrator's own differential was **14 rows**; the RD's sweep was **833 rows**. **Both took
  every base at the project root or inside a hard-blocked family.** A later sweep with a base in a
  **non-family** directory (`<root>/docs`) found **8 rows that moved the other way** — a
  *corrected false deny* (the files land outside every family), so not a hole, but a real widening
  that had been written down as "0 moved the other way" and, worse, as "one earlier LOW is closed".
- The widening was **accepted** — it is the direction the ruling takes (the verdict follows the
  file, not the spelling). What was not acceptable was the **undisclosed** part.

**Why:** the sentence reads as a general truth and is not one. A matrix is a sample of a space, and
the sample's *axes* decide what it can see. Here the missing axis was the **base**, and the base is
the one input the whole slice was about.

**How to apply:**
- When a claim is "nothing moved", **say which rows** and **which axes they varied** — or say
  "nothing moved **among the rows I measured**".
- Sweep the axis the change is **about**, not the axes the diff happens to touch.
- A direction change that is **accepted** is recorded as accepted; "closed" and "accepted" are
  different words and the difference is the whole point. This repository already records the
  difference elsewhere as a defect shape (§18.3, §9.40).
- When an independent review contradicts your own measurement, **re-measure before arguing**: here
  the reviewer was right on all three findings, and two of them contradicted claims the
  orchestrator had already written into the durable backlog.

Related: [[test-a-second-gate-against-the-first]], [[a-missing-process-must-never-read-as-a-verdict]]
