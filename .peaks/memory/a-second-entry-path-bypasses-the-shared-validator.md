---
name: a-second-entry-path-bypasses-the-shared-validator
description: a-second-entry-path-bypasses-the-shared-validator
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-fromdag.md
---

`--from-dag` returned from `runDispatchAction` before `preflightDispatch`, which is where the warm
single-dispatch path runs `validateRole`. The DAG path's only check was `supportsRole`
(`role.length > 0`), so `'a b'`, a 257-char string and a control character were accepted there and
refused on the warm path. The same validator existed; one of the two entry paths never called it.

**Why:** a short-circuit branch added before the shared preflight inherits none of its checks. The
branch was correct about "skip the single-dispatch pipeline" and silently wrong about "skip its
validation".

**How to apply:** when adding an early-return branch, list the checks the shared path performs and
decide each one explicitly. If the branch should keep a check, call it before the branch's own work.
