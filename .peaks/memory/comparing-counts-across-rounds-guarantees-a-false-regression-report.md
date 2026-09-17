---
name: comparing-counts-across-rounds-guarantees-a-false-regression-report
description: Comparing counts across rounds guarantees a false regression report
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-09-16-session-5bcf09/txt/handoff.md
---

A long job measured its own size repeatedly and kept disagreeing: 14 → 22 → 25 → 27 changed files, RD test counts of 30 vs a measured 58, "27 new cases" vs 31, a "13 paths" row that no longer matched. Every number was TRUE WHEN WRITTEN; the tree moved underneath. A verifier running any of those tables literally would report a regression that does not exist. **How to apply:** date-stamp measured counts, or re-measure in the same step as the comparison — never compare a number from an earlier round against a measurement from now. When a count must be corrected, leave the stale value visible and record the command that re-derives it, rather than silently swapping the digit. Four separate instances were found in one session, the last one being a residual that a repairing agent correctly refused to re-total because the baseline it would subtract from had never been re-measured.
