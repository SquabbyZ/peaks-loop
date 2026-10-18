---
name: a-spawned-child-unref-must-wait-for-close
description: a-spawned-child-unref-must-wait-for-close
metadata:
  type: decision
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-container.md
---

Both isolation-lease spawners must resolve the envelope and then defer `child.unref()` with
`setImmediate` inside the `close` handler. A synchronous `unref()` after `resolve` lets the parent's
event loop empty before the buffered stdout drains, so the caller receives an empty envelope with
exit 0 — the original §11.4 bug.

**Why:** the worktree path already carried this fix and a comment explaining it; the container path
cited the comment and did not apply it. `detached: true` plus buffered stdout is the condition.

**How to apply:** any `spawn(...)` with `stdio: 'pipe'` that the parent waits on must unref only after
`close`. A test that asserts ordering at an injected seam is the regression guard; a real subprocess
inside vitest cannot reproduce the race because vitest holds its own ref'd handles.
