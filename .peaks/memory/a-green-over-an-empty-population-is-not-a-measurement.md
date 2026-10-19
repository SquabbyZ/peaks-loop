---
name: a-green-over-an-empty-population-is-not-a-measurement
description: a-green-over-an-empty-population-is-not-a-measurement
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-lintpop.md
---

`eslint .husky/` reported "File ignored by default" and exit 0. The run examined nothing, but its
output is indistinguishable from a clean run to a reader who only sees the exit code and the finding
count. The census already refused an empty population; the lint legs did not report one at all.

**Why:** a finding count has no denominator. Zero findings over 0 files and zero over 2000 are the
same number and opposite facts.

**How to apply:** any leg that reports findings must also report how many files it examined, and must
refuse (or loudly warn) when that number is 0 unless the caller opts in. Test the empty case.
