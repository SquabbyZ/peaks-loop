---
name: prove-a-cli-flag-with-an-observable-marker
description: prove-a-cli-flag-with-an-observable-marker
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-lintconfig.md
---

The `--config` fix is proved by a scratch ESLint config whose rule emits a marker: before the fix the
default config ran and the marker never appeared; after, both `check` and `baseline` emit it. The
injection control (revert the two mappings) reds exactly the two arms.

**Why:** an argument-spy test can prove the value reached a function without proving the command used
it. A marker travels the whole path and is visible in the output.

**How to apply:** for a CLI flag that selects a config or mode, make the selected input produce an
observable difference and assert on that difference. Keep a no-flag control.
