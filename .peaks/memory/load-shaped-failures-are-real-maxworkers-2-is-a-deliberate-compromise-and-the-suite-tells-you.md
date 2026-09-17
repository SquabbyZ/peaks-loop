---
name: load-shaped-failures-are-real-maxworkers-2-is-a-deliberate-compromise-and-the-suite-tells-you
description: Load-shaped failures are real, maxWorkers=2 is a deliberate compromise, and the suite tells you
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-16-session-5bcf09/sc/release-1-load-shaped.md
---

On this box, 290-file unit suite is `290/290` at maxWorkers=1 and at maxWorkers=2, but briefly NOT at 2 when 327 leaked `peaks` node processes were starving the forker. The mw=2 default chosen for `vitest.workers.ts` is therefore not a performance pick; it is a deterministic-default pick, validated by the same 5-second isolated run that caught the flake. A guard that cannot fail is indistinguishable from a working guard — same shape applied to a suite.
