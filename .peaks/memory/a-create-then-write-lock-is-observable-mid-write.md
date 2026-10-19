---
name: a-create-then-write-lock-is-observable-mid-write
description: a-create-then-write-lock-is-observable-mid-write
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-teststability.md
---

`writeFileSync(path, body, { flag: 'wx' })` is an exclusive CREATE followed by a WRITE, not an
atomic create-with-content. A concurrent caller can open the file between the two steps, read a
zero-byte or partial body, and conclude the lock is stale — then unlink a live lock and create its
own. Measured as `bootCount` 2 in the web daemon race.

**Why:** the O_EXCL flag guarantees only that the file did not exist; it says nothing about the body
being complete, and a reader has no way to tell "mid-write" from "abandoned" by content alone.

**How to apply:** treat an unreadable lock body as HELD while the file's mtime is within the stale
budget, and reclaim older ones. Make reclaim atomic (quarantine rename, re-read the moved body,
own-create identity check) and restore with an exclusive create, never a replace-capable rename.
