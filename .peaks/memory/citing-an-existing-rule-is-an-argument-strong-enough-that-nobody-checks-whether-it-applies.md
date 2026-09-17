---
name: citing-an-existing-rule-is-an-argument-strong-enough-that-nobody-checks-whether-it-applies
description: Citing an existing rule is an argument strong enough that nobody checks whether it applies
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-17-session-607ead/txt/handoff-rid-d-group.md
---

A fix was declined by citing a lesson from the repo's own history: "adding a second edit on top of
someone's uncommitted change is exactly the shape 4.0.48 recorded — two slices silently overwriting
each other's audit evidence." That is a real recorded lesson, it is about concurrent writers, and it
sounds like it applies. It does not: 4.0.48 is about two slices writing the **same rid-less gated
artifact path** under `.peaks/_runtime/`, not two edits to a tracked test file. The false claim it was
protecting — a sentence whose scope exceeded its assertion, written in the same session — stayed.

**Why:** invoking a documented precedent transfers its authority to the current case without arguing
the mapping. It reads as rigour, so it does not attract scrutiny, and unlike a bare assertion it has a
citation to point at.

**How to apply:** when a decision cites a past incident, **read the incident** and state the property
that must match. If the match is not exact, say which part is and which is an analogy — and if the
thing being protected is a defect introduced in the same session, weigh that explicitly rather than
letting precedent close the question.
