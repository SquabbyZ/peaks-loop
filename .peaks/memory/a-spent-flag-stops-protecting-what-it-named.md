---
name: a-spent-flag-stops-protecting-what-it-named
description: an explicit opt-in flag earns its protective power from how rarely it is required — discriminate the dangerous direction (coverage lost) from the harmless one (coverage gained) instead of making every routine change pay the ceremony — measured on rid `2026-10-03-scope-growth-vs-shrink`, backlog 2.50
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-29-session-b7cf21/rd/requests/w11b-scope-growth-vs-shrink.md
---

`--rescope` was invented so that redrawing the lint scope had to be **stated**: the guard refuses a scope
change, the operator passes the flag once, and the artifact records that a human chose the new boundary.
Its value is entirely in how seldom it is legitimately typed.

An hour later that value was nearly spent by the guard's own generalisation. Widening the trip to compare the
whole `scope` block (§2.43) made *any* population change a boundary event, so splitting one oversized file
into eight — the exact work the ratchet exists to make happen — was refused: `SCOPE CHANGE without
--rescope … measured files 943 → 950`. The options were to pass the flag (and teach every future reader that
`--rescope` can mean "I added a file") or to route around the guard. Neither. The rule now discriminates by
**direction**:

- the flag is required when the boundary *text* changed (`rule`, `dirs`, `extensions`), or when the
  **leaving set** is non-empty — coverage that could have been lost, including the rename-out-of-`src/`
  evasion and, acceptably, honest deletions;
- pure growth proceeds with no flag and prints `scope grew: 943 -> 950 (7 entered, 0 left the scope)`.

The reason growth is safe is not that growth is harmless — it is that **the ratchet still does the work**: a
bigger watched population can only raise measured counts, and a raised ceiling is refused as `RAISED`
regardless of the flag. That is an arm, not an argument (`growth + rising ceiling → still RAISED`, asserted
on the message as well as the exit code). What was relaxed is the ceremony; what stayed armed is the number.

**Two details that carry beyond this repo.** *Leaving* must be a **set difference**, never a subtraction:
`950 > 943` does not prove nothing left, because one file can exit while three enter, and the arithmetic
reading would bless the evasion the rule exists to catch. And the refusal names the offenders, because a
boundary message that says only "the scope changed" cannot be acted on.

General form, for every explicit opt-in this campaign adds: before widening when a flag fires, ask what the
flag's *rarity* is protecting. If the answer is "a human noticed a dangerous class of change", then
discriminate that class precisely — direction, set membership, or attribution — instead of making routine
work pay the cost of the exception and quietly training everyone to type the flag without reading it.

Related: `a-ceiling-row-is-born-measured-before-it-is-committed` (why the flag alone was not enough to land
this descent), `a-leg-must-not-choose-its-own-population`, `.peaks/docs/backlog.md` §2.50 / §2.51.
