---
name: read-the-durable-ledger-and-keep-the-in-memory-set
description: read-the-durable-ledger-and-keep-the-in-memory-set
metadata:
  type: decision
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-cleanup.md
---

The fix reads `.peaks/_sub_agents/<sid>/active-dispatches.json` and finalizes matching rows via
`markCompleted`, the same effect `sub-agent finalize --batch` has. The in-memory `Map` is kept for
same-process callers, and both paths are covered by arms.

**Why:** the durable ledger is what a new process can see; the in-memory map is what a long-lived
caller can use without a disk read. They answer different lifetimes, so the wrapper keeps both.

**How to apply:** when a component's state is per-process but an action must work across processes,
add the durable read next to the in-memory one; do not delete the in-memory path.
