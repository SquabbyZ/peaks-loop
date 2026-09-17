---
name: widening-a-guard-can-add-false-positives-against-live-files-instead-of-finding-anything
description: Widening a guard can add false positives against live files instead of finding anything
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-17-session-607ead/txt/handoff-rid-a3.md
---

A2 deliberately declined to widen the citation guard to bare non-test paths, and recorded the cost as
"50 findings, none of them citations". Read closely, that understates it: among the 50 there are tokens
that name files which **do exist**, spelled in a way the widening would misreport. A cited
`audit-goal-service.js` has no such file, but its `.ts` twin does; and `loop-hygiene-block.test.ts.`
appears 22 times across 22 distinct files, every one of them a live `SKILL.md:<n>` reference whose only
difference from a real path is a sentence-final period.

**Why:** "no true positives" reads as *neutral* — a widening that finds nothing is merely useless. The
measurement says it is worse than useless: it would redden the suite on live, correct files, and the
natural response to that is an allowlist, which is how a guard gets loosened until it checks nothing.
The distinction between "finds nothing" and "finds the wrong things" is what decides whether a proposed
widening is declined or merely deferred.

**How to apply:** when measuring a proposed guard widening, classify the hits three ways — true
positives, no-ops, and **false positives against live files** — and report all three. A count that
collapses the third into the second hides the reason to say no.
