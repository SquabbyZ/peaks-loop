---
name: a-marker-writer-should-be-o-excl-and-shared
description: a-marker-writer-should-be-o-excl-and-shared
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-qamarker.md
---

The marker is created with `writeFile(..., { flag: 'wx' })`; an existing marker returns
`created: false` and its bytes are untouched. Both callers — the new verb and `createRequestArtifact`'s
success path — use the same service.

**Why:** `wx` makes "create if absent" atomic, so two concurrent callers cannot both create and an
existing marker is never truncated. One writer means content, permissions and idempotence cannot drift
between the two paths.

**How to apply:** for an existence-only marker, use `wx` and report `created`. Share the writer between
the init path and the dedicated verb.
