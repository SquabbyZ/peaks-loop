---
name: nothing-to-clean-must-not-read-as-cleaned
description: nothing-to-clean-must-not-read-as-cleaned
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-cleanup.md
---

An absent batch now returns `cleaned: false`, and the CLI exits 1 with `BATCH_NOT_CLEANED`, naming the
ledger path. `--force` extends the clean to rows in a non-`queued` status but never rescues an absent
batch.

**Why:** the orchestrator records a `cleaned: true` as done. A false success is worse than a failure
because it removes the signal that the cleanup did not happen.

**How to apply:** keep the "target absent" and "target cleaned" outcomes distinct in both the envelope
and the exit code. Put the path or id the caller can check in the refusal.
