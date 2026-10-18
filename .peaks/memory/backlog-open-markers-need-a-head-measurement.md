---
name: backlog-open-markers-need-a-head-measurement
description: backlog-open-markers-need-a-head-measurement
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff.md
---

The backlog's OPEN markers are not machine-checked. On 2026-10-18 three were already fixed at HEAD:
§14.1 (`988c6197`), §13.3's first half (`d62eda51`), and §16's backCompat enforcement (`0cfc25c0`).
A reader who treats the heading as the state re-implements finished work.

**Why:** §9.40 names the class; the section-16 revision that shipped the fix did not update the
section it was about.

**How to apply:** before turning any backlog item into a slice, run the item's own measurement at
HEAD (the `git log -S` or the cited command). Correct the marker in the same pass. A heading is a
claim, not a result.
