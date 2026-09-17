---
name: derive-from-the-source-of-truth-never-re-declare-it-and-do-not-keep-a-field-nobody-reads
description: Derive from the source of truth, never re-declare it — and do not keep a field nobody reads
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-17-session-607ead/txt/handoff-rid-b2.md
---

Two decisions in one slice, both the same shape.

**Derive, don't re-declare.** Gate-evidence keys are derived from `getPrerequisitesFor('rd',
'qa-handoff', type)` — the same table the gate itself enforces. The alternative (a hand-maintained
per-type list) is what produced the wrong `config = 3`, and it would drift again on every table change.
Because the derivation reads the authority, the code was correct even while the prose about it was
wrong.

**Do not keep a statement nobody reads.** `docs`/`chore` slices were declaring `projectScan`, but the
only consumer of that map runs at `rd:qa-handoff`, which those types do not have — so the declaration
was read by nothing. It was removed, and the reason recorded verbatim: *keeping it recreates the defect
this whole slice existed to fix, in miniature.*

**How to apply:** when adding a field or a list, point at its consumer and name the condition under
which that consumer runs. If the two do not line up for every case, one of them is wrong. And when an
authority already answers a question, call it rather than restating its answer — a restatement is a
second source of truth that fails silently.
