---
name: on-this-host-the-full-suite-cannot-pass-and-bash-is-the-wsl-launcher
description: On this host the full suite cannot pass and bash is the WSL launcher
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-10-22-session-b0e6e2/txt/handoff-t1-backlog-2026-10-23.md
---

Measured 2026-10-23 on the Windows dev host for `D:\projects\peaks-loop`.

- The **full unit suite cannot pass here**: 7 web test files fail because the host's loopback TCP is
  broken (the repository's own backlog §10.1). A tree-wide run is therefore not evidence of anything.
  Run scoped suites, and never present a full-suite result as a verdict.
- `bash` on PATH is `C:\WINDOWS\system32\bash.exe`, the **WSL launcher**, and it cannot run at all
  (`execvpe(/bin/bash) failed`). A test that asserts a shell hook spawns therefore fails with
  `expected -1 to be 2` — that is the host, not the code under test. 15 arms in
  `tests/unit/services/hooks/` are in this shape.
- `peaks mut run` (Stryker) **cannot complete** on this host: the installed binary lacks
  `@stryker-mutator/core`, and a working-tree run hits `EPERM` inside Stryker's sandbox copy.

**How to apply.** Attribute a red to the host only after re-running it ALONE. Concurrency alone
produces transient reds on this host — a 30 s timeout under load, and `ENAMETOOLONG` from an
inflated argv — so a red measured under parallel load is not yet a verdict. Report the attribution
with the command that produced it.
