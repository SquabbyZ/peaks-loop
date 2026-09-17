---
name: a-redactor-that-rewrites-the-diagnostic-is-a-redactor-that-deleted-the-diagnosis
description: A redactor that rewrites the diagnostic is a redactor that deleted the diagnosis
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-17-session-607ead/txt/handoff-rid-c0.md
---

The fix for a false sensitive-content refusal produced failure messages naming the check and the
matched term — and those messages arrived, on the real CLI, reading `an [redacted] / [redacted] /
[redacted] assignment`. Every failure *message* passes through `redactSensitiveErrorMessage`, whose
catch-all `/(secret|token|password|api[-_ ]?key)/gi` had rewritten the very terms the message existed
to report.

**Why:** the redactor and the diagnostic have opposite goals and neither knows about the other. The
redactor is correct to be blunt — it is the last line before a message reaches a log — and the
diagnostic is correct to name what tripped. Composed blindly, the blunter one wins and the operator
gets a sentence with the answer cut out.

**How to apply:** when a message must name something the redactor targets, move that something to a
**structured field** the redactor does not touch (`data.matchedTerm`) and keep the prose free of the
target words — rather than weakening the redactor. Then verify the field cannot carry a value: this one
returns terms from a fixed vocabulary, checked over 33 adversarial titles with 0 escapes. A free-text
"matched substring" field would have re-opened exactly the leak the redactor exists to close.
