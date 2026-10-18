---
name: a-success-value-can-be-the-never-did-anything-branch
description: a-success-value-can-be-the-never-did-anything-branch
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-cleanup.md
---

`SubAgentJobWrapper.cleanup()` returned `{cleaned: true}` when the batch was NOT in its in-memory set,
and a fresh CLI process always had an empty set. The success value was the "this process never
dispatched anything" branch, so a self-vouch was indistinguishable from a real clean. Six batches
returned `cleaned: true` while `active-dispatches.json` still held all six.

**Why:** a command whose state lives only in the process that created it cannot be invoked from a new
process to act on that state. The absent-target branch must not be the success branch.

**How to apply:** for a hygiene/cleanup command, read the durable record the producing run wrote; make
"nothing matched" return false or fail, never true. Test from a FRESH process, not the one that wrote
the state.
