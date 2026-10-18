---
name: a-dimensional-header-is-not-a-set-of-assertions
description: a-dimensional-header-is-not-a-set-of-assertions
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-concurrency.md
---

The guard's header listed four dimensions — render, behavior, integration, a11y — but every test matched
strings in `vitest.config.ts`. "Cap within a sane bound" and "env override honored" had ZERO
assertions: a cap of any value and an ignored `PEAKS_VITEST_MAX_WORKERS` both stayed green. The
header was true about the categories it intended and false about the evidence.

**Why:** a dimension label is a plan, not a test. A string match on the config is a render assertion;
it cannot see a value change or an env branch.

**How to apply:** for each dimension a guard claims, name the assertion that would red if the property
were false. If the property is a computed value or an env branch, evaluate it — do not grep for its
name.
