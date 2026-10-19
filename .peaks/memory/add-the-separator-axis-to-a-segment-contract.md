---
name: add-the-separator-axis-to-a-segment-contract
description: add-the-separator-axis-to-a-segment-contract
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-sessid.md
---

`isUnsafePathInput` is a traversal guard: it rejects `..`, absolute paths, backslashes and empty
segments, but admits `a/b`. A caller whose contract is "one path segment" must add the separator check
itself; the shared predicate must not be widened because artifact paths legitimately contain `/`.

**Why:** the same predicate serves two contracts. Widening it for the session-dir case would reject
legitimate artifact paths; narrowing the contract to the predicate is the defect this slice fixed.

**How to apply:** at a segment boundary, compose `isUnsafePathInput` with an explicit no-separator
check and name the helper for the contract (`isSinglePathSegment`). Keep the traversal predicate as is.
