---
name: a-claim-written-in-three-places-and-pinned-by-no-test-will-drift
description: A claim written in three places and pinned by no test will drift
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-17-session-607ead/txt/handoff-rid-b2.md
---

`config`-type slices were documented — in a source comment, in the schema reference, and in the RD
tech-doc — as declaring **three** gate-evidence keys. The measured answer is **two**. The code was
right the whole time: it derives from `getPrerequisitesFor('rd', 'qa-handoff', type)`, and
`CONFIG_TABLE['rd:qa-handoff']` really is `[SECURITY_REVIEW]` alone. Only the prose was wrong, and it
was wrong identically in three places, because all three were written from the same guess.

**Why:** repetition reads as corroboration. Three sources agreeing looks like three checks; here it was
one unchecked assertion copied twice. What would have caught it is one test that measures the count —
and there was none, so nothing pushed back on the guess.

**How to apply:** when a number or a set appears in more than one place, **pin it with a test that
measures it**, and make the expectation a **literal**, not a value derived from the same constant the
implementation uses (an expectation computed from `GATE_EVIDENCE_KEYS` cannot notice that constant
being renamed — measured: renaming `perfBaseline` left the derived expectation GREEN and reddened only
the literal one). Repeated prose is not redundancy; it is one assertion wearing three hats.
