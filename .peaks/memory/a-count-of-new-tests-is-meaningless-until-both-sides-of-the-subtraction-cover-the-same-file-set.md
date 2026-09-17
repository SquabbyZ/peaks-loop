---
name: a-count-of-new-tests-is-meaningless-until-both-sides-of-the-subtraction-cover-the-same-file-set
description: A count of "new tests" is meaningless until both sides of the subtraction cover the same file set
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-17-session-607ead/txt/handoff-rid-a1.md
---

A completion report claimed "17 files, 240 passed (baseline 231, **+9 new cases**)". The baseline 231
came from the 16-file injection battery, which **does not include** `codegraph-hints` (8 cases); the
17-file verification set's real baseline was 239. Net change was **+1**. Every number was individually
true and the arithmetic between them was invented.

**Why:** mixing file sets in a delta is invisible because both numbers are real, both were measured,
and the subtraction looks like bookkeeping. It survived the agent that produced it and was caught only
by the agent that re-ran both sets against a common denominator.

**How to apply:** report deltas **per file set**, and cross-check that the sets reconcile
(`231→232` / `239→240` / `320→321` is three statements that can each be wrong; a single "+9" cannot be
checked at all). When a change adds exactly one case, say which one, so the +1 is attributable rather
than asserted.
