---
name: an-absence-and-a-zero-must-be-different-documents-not-different-names
description: an absence and a zero must be different documents, not different names
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-20-session-a545d0/txt/handoff-003.md
---

A review that found nothing and a review that never ran both look like "no findings" if you only carry a count. Naming the states differently (`ok` vs `no-routed-language`) does not help: the shape is still one number, so any consumer that reads the number will read whichever they expect.

The shape that works here: the **request** and the **result** are different documents. A packet is written with `state: awaiting-envelope` and `findings: null`. A completed review is a separate file carrying `findings: []`. There is no single document in which "never ran" can be confused with "clean", because the clean document does not exist until the review ran.

That generalises to any two-phase flow where the expensive step might not happen: emit a durable "awaiting X" artifact first, and let the completion artifact be a different file. Then a missing completion file is provably a missing step, not an empty result — and the check is a file's existence rather than a field's value.

Related: [[a-count-cannot-distinguish-zero-findings-from-never-ran]], [[a-feature-can-be-fully-tested-and-still-be-unreachable-from-production]].
