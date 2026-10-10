---
name: the-ratchet-s-only-joint-decision-exception-works-and-it-is-conditional
description: The ratchet's only joint-decision exception works and it is conditional
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-10-session-062f74/txt/handoff.md
---

`COUPLED_SIZE_RISE` in `.husky/monotonic/compare.mjs` permits the `fileSizeOverCap` ceiling to RISE
if and only if `fileSizeExcessLines` strictly falls in the same comparison. This had only ever been
tested at the pure-function level; this round demonstrated it end-to-end through
`node .husky/peaks-gate-baseline.mjs` in both directions, on the real census and the real baseline.
Permitted: overCap 79 → 80 while excess 22677 → 22661 (a fall of 16) → `exit 0`, the file was
written, and the run printed `ROSE, AND THIS RATCHET PERMITS IT` naming both sides of the pair.
Refused: overCap 79 → 80 with excess 22677 → 22680 (both up) → `exit 1`, `Nothing has been
written`, baseline sha256 unchanged. The two directions differed in exactly one thing — the
direction of the excess row — so the safety valve is conditional, not handed out freely. Recorded
caveat: the demonstrated fall came from deleting 19 lines out of one file, NOT from the
"split one 1,125-line file into four" intermediate shape the contract's own comment narrates; the
census sees both as the same unit (raw lines), but that specific story remains unproven.
