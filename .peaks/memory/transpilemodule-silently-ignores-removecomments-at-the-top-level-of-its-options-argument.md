---
name: transpilemodule-silently-ignores-removecomments-at-the-top-level-of-its-options-argument
description: transpileModule silently ignores removeComments at the top level of its options argument
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-17-session-607ead/txt/handoff-rid-a3.md
---

The `tsc removeComments` byte-comparison used to prove "this change is comments-only" has a trap: when
`removeComments` is passed as a top-level key of `transpileModule`'s second argument it is **silently
ignored**. The output still carries comments, so a pure-comment diff compares as different and looks
exactly like a logic change. It must go inside `compilerOptions`.

**Why:** the check is used precisely when the change *is* only comments, so its failure mode is a false
alarm on a correct change — and the tempting fix is to stop trusting the check rather than to fix how
it is called. It is also silent, so nothing distinguishes "no comments were removed" from "the option
did nothing".

**How to apply:** always pair this check with a **live control** — mutate one piece of real logic and
confirm the transpiled outputs *do* differ. Without that, "byte-identical" is not evidence that the
option ran; it may only mean the option was never read. A1 and A2 both used this check; A3's first
script hit the trap and was corrected by the control.
