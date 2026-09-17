---
name: a-number-reported-from-one-bucket-of-a-two-way-split-looks-exactly-like-a-total
description: A number reported from one bucket of a two-way split looks exactly like a total
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-17-session-607ead/txt/handoff-rid-d-group.md
---

A census split colon-bearing spans into `:<digits>` and everything else, printed
`other colon spans = 804`, and the write-up carried **804** as the colon-span total. The total was
**864** (the digits bucket held 60). The conclusion it supported — "widening to `:` would report all
of these" — was wrong in mechanism as well: widening actually reports **11 findings, and all 11 name
a file that exists**, i.e. the widening is *directionally* wrong, not merely expensive.

**Why:** a bucket label is a qualifier, and qualifiers are the first thing dropped when a number moves
from a debug print into prose. The result is indistinguishable from a real total, and it agrees with
the conclusion the author already held, so nothing about it looks off.

**How to apply:** when a measurement has more than one bucket, report the **sum** and the split, and
check they add up in the text that carries the number (804 + 60 = 864 would have caught it on sight).
Prefer reporting the thing that decides the question — here the *output* of the proposed change, which
was measurable by applying it — over the size of the input set it draws from.
