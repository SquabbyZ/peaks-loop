---
name: pin-behavior-through-the-public-export
description: pin-behavior-through-the-public-export
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-memory-tests.md
---

The new tests import `containsSensitiveConfigValue` / `assertSafeMemory` from the package's public
surface (`index.ts`), not from the private store module, and assert the refusal's `check` field
(`metadata key scan`) rather than a reimplemented predicate.

**Why:** a test against a private reimplementation can stay green while the public path changes; the
public export is what consumers use.

**How to apply:** for a coverage slice, call the exported entry point and assert the observable fields
the caller sees. Keep private helpers private.
