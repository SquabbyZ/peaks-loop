---
name: an-export-count-is-a-measurement-with-a-date
description: an-export-count-is-a-measurement-with-a-date
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-policy.md
---

The backlog said "11 of 13 exports still unreferenced" from a 2026-09 measurement. Re-measured on
2026-10-19: only six had zero references, and the live-importer set had changed (F2 wired one path,
tests used others). Acting on the stale count would have removed exports that now have a reader or
pinned ones that are already covered.

**Why:** reference counts move with every slice; a count in a prose backlog is a snapshot, not a
property. The same file also said "the 5→3 half is pinned by nothing", which was true.

**How to apply:** re-run `grep -rnw` for every symbol before deleting or wiring it, and record the
fresh counts in the closing note. Treat a backlog count as a hypothesis with a date.
