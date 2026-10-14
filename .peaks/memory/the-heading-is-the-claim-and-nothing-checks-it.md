---
name: the-heading-is-the-claim-and-nothing-checks-it
description: The heading is the claim, and nothing checks it
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-14-session-2f9323/txt/handoff.md
---

A backlog whose headings carry implementation state will drift from its own bodies, and nothing in the tree
detects it. Measured 2026-10-14: all four §9 decision items (9.1–9.4) were ruled by the user on 2026-10-13
and **three were already implemented** — 9.1 in `3b95e00a`, 9.2's ruling in `3059ac27`, 9.3's both halves in
`435445dd`, 9.4's first half in `d3684dbc` — while every one of those headings still read *"needs the user's
decision"*. A reader who trusts the heading re-implements finished work; a reader who trusts the body does
not. This repository had already recorded the theme three times (`237efb5b`, `fb9cb3bc`, `90b7c271`); what
this session added is the measurement that the drift was total, not partial.

**Why:** the heading is the only part of a long item most readers reach, so it is the part that must not
outrun the body — and it is the part with no checker.

**How to apply:** before acting on a backlog item, measure its state rather than reading its heading. When
correcting one, cite a commit or rid that you verified with `git` in the same session, and say the state
*as of a date* for anything still in flight. Where the body and your measurement disagree, keep **both**
readings visible — the repository's method is that a correction is recorded, not overwritten.
