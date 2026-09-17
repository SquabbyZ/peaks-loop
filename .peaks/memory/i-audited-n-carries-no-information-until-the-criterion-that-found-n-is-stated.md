---
name: i-audited-n-carries-no-information-until-the-criterion-that-found-n-is-stated
description: "I audited N" carries no information until the criterion that found N is stated
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-17-session-607ead/txt/handoff-rid-c-group.md
---

One CHANGELOG sentence — "13 guard points, 10 with no measured control group" — produced **four different
answers** depending on the criterion: 13 (points counted by filename match, which is what it actually
did), 11/2/0 (both arms present), 21/0/1 (delete the guard, does an assertion redden), and 45 (the
corrected set at assertion granularity). The sentence was neither right nor wrong. It was
**undecidable**, because the standard it used was never written down.

The same defect repeated inside the audit itself, three times. C1 enumerated guards by matching the
filename against `guard` and missed three — including the sole enforcer of the project's red line,
which has no `guard` in its name. C2 redid it and QA, using **C2's own keyword table**, found nine more
that C2 had missed *inside its own declared search key*. C4 then found the filter was applied at
**file** granularity where the criterion was about **assertions**, dropping two more.

**Why:** a count looks like a finding, so it gets quoted; the search that produced it looks like an
implementation detail, so it does not. Every downstream reader inherits the number without the
boundary.

**How to apply:** state the criterion before searching, and state what it cannot see. "23 guard-shaped
tests in `tests/**/*.test.ts`, excluding the J-contract family, found by assertion subject" is
reproducible and falsifiable. "13 guards" is a number with a hidden definition. When you inherit a
count, the first question is not whether it is right — it is what it counted and how it looked.
