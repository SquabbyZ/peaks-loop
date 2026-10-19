---
name: not-comparable-is-not-distinct
description: not-comparable-is-not-distinct
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-residuals.md
---

`distinctFromKarpathy` returned true for a `skipped` third-party family — and after that arm was
fixed, still returned true when the KARPATHY side was `skipped`/empty. A review that produced no
verdict has no family to compare, on either side.

**Why:** a two-input predicate tends to guard the input the bug report named. The symmetric arm is
the one nobody writes.

**How to apply:** in any distinctness/similarity predicate, guard both inputs for the "no value"
sentinel (`skipped`, empty string) before the comparison, and assert both sides in the test.
