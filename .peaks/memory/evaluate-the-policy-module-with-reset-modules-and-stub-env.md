---
name: evaluate-the-policy-module-with-reset-modules-and-stub-env
description: evaluate-the-policy-module-with-reset-modules-and-stub-env
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-concurrency.md
---

The arms use `vi.resetModules()`, `vi.stubEnv(OVERRIDE_ENV, value)`, and a dynamic import of
`vitest.workers.js`; `vi.unstubAllEnvs()` runs in a `finally`. A plain import is evaluated once and
cached, so every later case would read the FIRST env value. `stubEnv(name, undefined)` deletes the key,
which is the only shape that reaches `parseOverride` as `undefined`.

**Why:** an env-reading module is a function of the process env at import time; a cached import is a
constant.

**How to apply:** for a module that reads env at import, reset the registry and stub the env per case.
Prove the unset case with a probe that asserts the key is absent from `process.env`.
