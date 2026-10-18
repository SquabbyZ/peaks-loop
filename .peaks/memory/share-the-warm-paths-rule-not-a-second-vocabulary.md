---
name: share-the-warm-paths-rule-not-a-second-vocabulary
description: share-the-warm-paths-rule-not-a-second-vocabulary
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-fromdag.md
---

The DAG path imports the same `validateRole` the warm path uses. It does not spell a second role
rule, and it emits the existing `emitDagFailure` shape with the warm path's nextActions.

**Why:** a copied rule drifts; the warm path and the DAG path would disagree on the next edge case.
One rule, two entry points.

**How to apply:** when a second path needs a check the first path already has, import the predicate.
If the failure envelope differs, reuse the path's existing failure emitter rather than inventing one.
