---
name: derive-the-probe-from-the-resolved-value
description: derive-the-probe-from-the-resolved-value
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-concurrency.md
---

The override arms compute `probe = DEFAULT_MAX_WORKERS + 1` and use `${probe}.9`, so neither probe can
equal the default. A literal `3` would equal a future default and pass vacuously when the env is
ignored; the derived probe reds in that case.

**Why:** an override test whose expected value coincides with the default cannot tell "honored" from
"ignored".

**How to apply:** derive the probe from the value under test (default + 1, default + 1.9) and assert
the delta, not a literal. Keep a mutation (ignore the env) as the proof the derivation works.
