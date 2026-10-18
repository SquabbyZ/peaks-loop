---
name: backlog-14-7-closed-by-a-parity-arm-not-a-shared-import
description: backlog-14-7-closed-by-a-parity-arm-not-a-shared-import
metadata:
  type: decision
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-parity.md
---

§14.7's two type derivations were closed by a parity arm, not by deriving one from the other. The
layering forbids the shared import: the commit leg is plain `.mjs` that must load under bare `node`,
and `src/**` may not read `.husky/**`. `CARRIER_ROLES` / `CARRIER_DIRS` keep their equality arm; the
two parsers get the 9-case corpus.

**Why:** a shared import would turn "the checker cannot run" from a refusal with a reason into a
module-resolution crash, which is the exact failure the split exists to prevent.

**How to apply:** for a duplicated derivation across the `src/` / `.husky/` boundary, arm the pair
with a corpus that drives both implementations. Do not "unify" by importing across the boundary.
