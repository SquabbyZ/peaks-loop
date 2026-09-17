---
name: an-injection-battery-that-swaps-the-call-site-has-never-tested-the-callee
description: An injection battery that swaps the call site has never tested the callee
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-17-session-607ead/txt/handoff-rid-a1.md
---

An independent QA agent found that the RD sub-agent's mutation battery validated **wiring, not parts**:
every arm swapped or broke the *call site* of `rollbackCodegraphConfig`, so the function's own body was
never falsified. A battery can be green across 4 mutations and still say nothing about whether the
helper it exercises works. QA added a fifth arm ("report success without writing") — 4 red — and only
then was the helper's test suite proven falsifiable.

**Why:** the failure is a *reach* problem, not a *count* problem. Four arms that all hit the same layer
look more thorough than one arm that hits two layers, and the count is what gets reported. This is the
same shape as 4.0.50's gate that reported 15/15 while running 1, at a scale small enough to pass
review.

**How to apply:** when reading an injection battery, ask **which layer each arm mutates** — call site
vs callee body vs the callee's own dependencies. If every arm is at the same layer, the battery proves
only that layer. When commissioning one, name the layers explicitly (here: the verb's wiring, and the
helper's body) instead of naming a count: "≥6 mutations" is satisfied by six mutations of one function.
