---
name: missing-and-malformed-are-two-author-time-failures
description: missing-and-malformed-are-two-author-time-failures
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-absentstate.md
---

The lint flagged `- state: implemented (working tree)` (malformed) but passed an artifact with NO
`- state:` line. The transition failed closed on both — `STATE_ORDER_UNREADABLE` — but only one was
caught where the producer could act. The missing-line case is a distinct failure with a distinct fix.

**Why:** a value validator runs on lines that exist. Absence has no line to validate, so it needs a
document-level check.

**How to apply:** for a machine-read field, test both the malformed value and the missing line. Put the
absence check at the document level and name the allowed set.
