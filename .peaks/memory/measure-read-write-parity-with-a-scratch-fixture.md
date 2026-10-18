---
name: measure-read-write-parity-with-a-scratch-fixture
description: measure-read-write-parity-with-a-scratch-fixture
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-lintidem.md
---

The parity test seeds a scratch baseline with one known tuple and a matching source file, then asserts
the written output subtracts it. The real tracked baseline is never written; a separate unit arm pins
the absent-flag default.

**Why:** running the writer against the tracked file would make the test's own artifact the fixture,
and a green result would not say which baseline was read.

**How to apply:** for a command that reads and writes the same kind of file, use a temp path for the
round trip and assert the delta. Pin the default separately by reading, never by writing.
