---
name: the-globally-installed-peaks-binary-silently-lags-src-by-days
description: The globally installed peaks binary silently lags src by days
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-14-session-2f9323/txt/handoff.md
---

`which peaks` resolves to a compiled single-file binary (measured 2026-10-14:
`/c/Users/small/AppData/Local/Author Software/nvm/.nodejs/peaks.exe`, dated **2026-10-04**) that reports
version **4.1.4**, identical to `package.json#version` — so comparing versions cannot reveal the lag.
Measured symptom: `sub-agent dispatch --prompt "@<file>"` dispatched the **literal 62-byte path** instead of
a 20,734-byte brief, with **no warning and exit 0**. Backlog §2.36 records the identical shape and was
**closed 2026-10-03 by a global reinstall** — it reopened within ten days.

**Why:** the fix for this defect is an installation action with no persistence, and nothing detects the drift
afterwards; meanwhile the failure is silent, so a session can spend hours having measured code it is not
running.

**How to apply:** for anything you will act on, run
`node node_modules/tsx/dist/cli.mjs src/cli/index.ts <args>` rather than the PATH binary. Treat a green
result from the PATH binary as unverified, and treat "the version matches" as no evidence at all.
