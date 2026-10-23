---
name: a-slice-that-contradicts-a-published-decision-must-put-that-diff-in-front-of-the-owner
description: A slice that contradicts a published decision must put that diff in front of the owner
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-22-session-b0e6e2/txt/handoff-t1-backlog-2026-10-23.md
---

Measured 2026-10-23 (rid `rid-t1-doctor-clean-row`). The slice made `skills:reference-parity:store`
go RED when the parity store is MISSING, where it had previously stayed silent. The 4.1.18
CHANGELOG records the neighbouring trade-off — "doctor stays silent when a check is clean" — as an
**accepted** trade-off, not an oversight. The slice's own review read the CHANGELOG, kept its change
on the reasoning that the severity stays `warning` and the doctor exit code does not move, and
disclosed the conflict.

That reasoning is a technical judgment about a PRODUCT decision, and the repository's rule is that
such a decision belongs to the owner. So the conflict became its own item in the commit gate, with
the trade-off quoted, instead of a line inside a diffstat.

**How to apply.** Before committing, look for the slice's change in the PUBLISHED record — the
CHANGELOG, the backlog's own decision log — and not only in the code. If the slice contradicts a
published decision, give the commit gate that diff as a named item.

The measured consequence is what makes the item answerable rather than a matter of taste: the doctor
report went from **89 checks / 1 `skills:` row** to **90 checks / 2 `skills:` rows**, with
`summary.ok` / `failed` / `warnings` unchanged.
