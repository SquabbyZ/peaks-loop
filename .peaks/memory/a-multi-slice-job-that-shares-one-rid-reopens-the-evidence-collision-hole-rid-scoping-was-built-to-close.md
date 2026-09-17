---
name: a-multi-slice-job-that-shares-one-rid-reopens-the-evidence-collision-hole-rid-scoping-was-built-to-close
description: A multi-slice job that shares one rid reopens the evidence-collision hole rid-scoping was built to close
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-16-session-5bcf09/txt/handoff.md
---

Gate C's evidence paths are rid-scoped (`rd/code-review-<rid>.md`, `audit/security-<rid>.md`, …) so two slices cannot occupy one slot. But the scoping keys on RID, not on slice: a 3-slice job run under a single rid means slice-002's `qa-handoff` is satisfied by slice-001's review evidence — a false green, since the gate checks only that *some* file is there, not whose it is — while slice-002's reviewers overwrite slice-001's artifacts in place. **How to apply:** give every slice its own rid from the start. A multi-slice job shares a session and a job-id, never a rid. Detected mid-session by the orchestrator's own error; three independent reviewers later confirmed the cost as live (five `.action`→`async/await` conversions and a path count that could not be attributed because slice-001 was uncommitted).
