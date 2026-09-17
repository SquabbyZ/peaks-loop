---
name: an-independent-cross-check-that-reads-the-same-table-is-a-regrouping-not-a-check
description: An "independent cross-check" that reads the same table is a regrouping, not a check
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-17-session-607ead/txt/handoff-rid-d-group.md
---

A count was reported as reproducible two ways: 48 rows minus 2, and 33 + 12 + 1 read off two
sub-section headings. The second was called independent corroboration. It is not — the headings are in
the same table, so it is the same data regrouped, and it cannot disagree with the first count. Worse,
the arithmetic mixed units: `B` was counted by station while the `C-3` deduction was counted by row,
so "48 rows − 2" was subtracting across two different denominators. That is the same failure as the
"49" this group existed to correct, one size smaller.

**Why:** a second route to the same number feels like verification, and the number agreeing feels like
confirmation. But a regrouping is arithmetically forced to agree, so it carries no information — and it
displaces the check that would have (a genuinely different source, or a different unit).

**How to apply:** before calling a check independent, ask what would have to be true for it to come out
**different**. If nothing, it is a restatement. And when subtracting, name the unit once and use it on
both sides.
