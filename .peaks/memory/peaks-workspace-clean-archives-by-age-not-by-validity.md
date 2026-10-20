---
name: peaks-workspace-clean-archives-by-age-not-by-validity
description: peaks workspace clean archives by age, not by validity
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-10-20-session-c620de/txt/handoff.md
---

`peaks workspace clean` prunes session directories older than `--older-than` (default 168 h
plus a 24 h grace) and leaves *fresh* invalid directories untouched, so it does not clear
the doctor's `L3:l3-orphan-sessions` failure when the offending dirs are recent — and on
this repository it would also delete legitimate history (the 2026-10-09 session that holds
the request artifacts). Measured 2026-10-20: three invalid dirs were 34 h, 84 h and 178 h
old, all under the 192 h cutoff. The fix that works is to move them under a registered
system subdirectory — a new top-level name under `.peaks/_runtime/` fails
`RUNTIME_SYSTEM_SUBDIRS` and becomes the next orphan — e.g.
`.peaks/_runtime/_audit/orphans/`; doctor then reports 88 passed / 0 failed.
