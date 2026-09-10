---
name: a-slice-whose-core-behaviour-no-artifact-specifies-costs-multiples-of-its-peers
description: A slice whose core behaviour no artifact specifies costs multiples of its peers
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-10-session-528a63/txt/handoff-s4.md
---

S1, S2 and S3 of `peaks-web` each needed **one** repair pass. S4 needed **five**. The cause was not
carelessness: the tech-doc specified `login`'s behaviour under the disable gate, the profile path and
its guard — but **no approved artifact specified the completion protocol** — how the CLI learns the
user has finished logging in. The implementer invented one (a `login.confirmed` file). It survived a
review, then proved forgeable, racy (two runs deleted each other's confirmation), and unable to
distinguish an MFA-incomplete session from a real one. Replacing it with "the user closes the window"
then exposed a Playwright constraint (`storageState()` throws after disconnect), which forced a
snapshot design, which introduced an atomicity defect, which forced a rule amendment. Four of the
five rounds descend from that single unspecified behaviour.

**Why:** design gaps do not stay local. An invented behaviour becomes the foundation for every later
decision, and each layer built on it inherits its unverified assumptions — so the cost is geometric,
not linear, and it lands late.

**How to apply:** before dispatching implementation of a slice, check that every *observable behaviour*
it must have is pinned by an artifact. If a behaviour is genuinely undecided, take it to the user as a
decision **before** implementation, not after a review finds it. Estimate a slice with an unspecified
core at several times its peers.
