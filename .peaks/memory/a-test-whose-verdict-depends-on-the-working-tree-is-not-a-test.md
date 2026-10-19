---
name: a-test-whose-verdict-depends-on-the-working-tree-is-not-a-test
description: a-test-whose-verdict-depends-on-the-working-tree-is-not-a-test
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-teststability.md
---

`staged-size-leg` passed on a clean tree and failed when the tree held only `.peaks/docs/backlog.md`:
its non-empty branch asserted `checkedFiles > 0` even when no changed file was in the policy's
population. The verdict was a property of what happened to be uncommitted.

**Why:** a test may legitimately read the working tree (it is testing the push-gate leg), but the
assertion must hold for EVERY shape the reader can return, including a non-empty all-out-of-scope
set. The vacuous branch was the one the test never exercised.

**How to apply:** enumerate the reader's impossible-looking outputs — empty, all-exempt,
mixed — and assert each. When a conditional exists to handle one of them, give the conditional a
control that FAILS if it is reverted, otherwise a green suite on a clean checkout proves nothing.
