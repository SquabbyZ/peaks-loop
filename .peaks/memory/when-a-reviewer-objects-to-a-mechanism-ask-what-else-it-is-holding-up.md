---
name: when-a-reviewer-objects-to-a-mechanism-ask-what-else-it-is-holding-up
description: When a reviewer objects to a mechanism, ask what else it is holding up
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-10-session-528a63/txt/handoff-s4.md
---

In S4, a reviewer correctly flagged that a `.partial` staging file contradicted the project's
"no other artifact may hold these values" rule. The orchestrator removed it in favour of an in-memory
capture plus a **single** write — which also silently discarded the design's only *atomicity*. The next
round found that the single write truncates the previous session at open (`writeFileSync` defaults to
`O_TRUNC`) and then reports it as "unchanged", so a failed re-login destroyed a working profile while
telling the user nothing happened. The user then had to decide to restore atomicity and amend the rule.

**Why:** a mechanism in a reviewed design usually carries more than the property the review objected
to. Removing it to resolve one objection can quietly delete an unrelated guarantee that nobody had
named as load-bearing — and the next review round pays for it.

**How to apply:** before removing a mechanism to satisfy a review finding, write down what else it
does, and check each of those properties survives. If the replacement cannot preserve one, say so and
take it to the user as a trade rather than a fix. "Simpler" is not free; name what it costs.
