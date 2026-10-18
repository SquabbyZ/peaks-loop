---
name: a-typed-field-from-json-is-unvalidated
description: a-typed-field-from-json-is-unvalidated
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-release.md
---

`ReleaseState.active.currentStage` is typed `ReleaseStage`, but it comes out of a JSON file and
`readReleaseState` cast the parse. A stage the table no longer has (`hotfixed`) was returned verbatim;
the validator `isReleaseStage` existed and was never called. The fix validates `active` and every
`history` record and fails closed.

**Why:** the type annotation is a claim about the in-memory shape, not about the bytes on disk. A cast
moves the claim across the boundary without checking it.

**How to apply:** for every field a reader takes from JSON into a union/narrow type, call the
predicate at the boundary. Validate collections of the same shape too, not just the first element.
