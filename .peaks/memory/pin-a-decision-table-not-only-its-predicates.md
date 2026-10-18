---
name: pin-a-decision-table-not-only-its-predicates
description: pin-a-decision-table-not-only-its-predicates
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-policy.md
---

The predicate half (`RD_DEPRECATED_REVIEWERS` + `isDeprecatedReviewer`) was already pinned. The
decision-table half — the 5→3 fanout subset, the reviewer list minus deprecated, the karpathy slot —
was not. The new test asserts the relationships between the tables, not just each function's return
for one input.

**Why:** a predicate can be correct while the table it reads is wrong. The relationships are the
property: "the fanout types are exactly the accepted subset", "no deprecated reviewer is returned".

**How to apply:** for a policy module with several tuples, write one arm per relationship (subset,
difference, index). Derive the expected value from the other tuple; do not restate both literals.
