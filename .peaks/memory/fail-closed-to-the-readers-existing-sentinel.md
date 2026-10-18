---
name: fail-closed-to-the-readers-existing-sentinel
description: fail-closed-to-the-readers-existing-sentinel
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-release.md
---

The invalid stage returns `EMPTY_RELEASE_STATE` — the same sentinel `readReleaseState` already returns
for malformed JSON, a wrong version, and a missing file. A throw and a discriminated result were
measured and rejected: eight consumers read the plain `ReleaseState`, and no measured beneficiary
existed for the wider type.

**Why:** one reader should have one "cannot interpret this file" answer. A new shape for one more
invalid input makes every consumer learn two.

**How to apply:** when a reader already has a fail-closed sentinel, reuse it for a new invalid input
unless a consumer needs to distinguish the causes. Measure the consumers before widening the API.
