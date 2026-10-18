---
name: a-flag-can-govern-one-side-of-a-read-write-pair
description: a-flag-can-govern-one-side-of-a-read-write-pair
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-lintidem.md
---

`peaks lint baseline --baseline-file <path>` passed the flag only to `writeBaselineJson`; the read
side (`runEslint`) was built without it and silently used the default `.peaks/lint/baseline.json`. The
command's own `check` sibling passed the flag to both. Measuring against a scratch path therefore
wrote a file produced against a DIFFERENT baseline than the one named.

**Why:** a path option on a read/write command is one value with two consumers; wiring it to one is a
half-applied change that still runs green.

**How to apply:** resolve a path option once, before both the read and the write, and pass the same
value to both. Prove it with a scratch fixture whose expected output differs from the default's.
