---
name: peaks-web-3-of-4-shipped
description: "peaks-web job at 3/4 — S1/S2/S3 committed and E2E-verified on a real browser, S4 queued; AC2's page-dependent ratio is an open user decision"
metadata:
  type: project
  node_type: memory
  originSessionId: d6480ba9-afb1-45c4-8257-1f02bb103fc8
  modified: 2026-09-10T07:24:13.044Z
---

# peaks-web — 3 of 4 slices shipped (2026-09-10)

**Authority lives at `.peaks/memory/2026-09-10-peaks-web-s1-s3-shipped-s4-queued.md`** — this file is
only a session note so a future session knows the job's shape without re-deriving it.

| slice | commit | state |
|---|---|---|
| S1 core commands | `4134757` | committed, **E2E-verified** |
| S2 daemon + isolation | `f4b5e34` | committed, **E2E-verified** |
| S3 acquisition + disable gate | `97d44ca7` | committed, **E2E-verified** |
| S4 persistent login | — | **not started** |

Separately shipped: `4637baa8` (Windows console-window fix for the peaks `Bash` hooks — root cause
was MSYS2/Git Bash allocating a console for shell-form hook commands).

**Each slice had a blocking defect that green tests did not catch**, found only by a three-lens
review: S1's storage-state guard failed all six verbs; S2's liveness oracle spawned a second daemon
(Q8); S3's loader executed an unverified package off `PATH` (RCE).

**Open decision (the user's):** AC2 says `snap ≤ MCP snapshot ÷ 5` and names no page. Measured
**33.5×** on a content-rich page, **0.59×** on a minimal one. It is not a property of the
implementation alone. Do not reword it silently.

**Queued:** S4; S5 (rebuild the deleted session-dir guard test); `withEnv` not restoring intra-file
(17 call sites / 5 files); several recorded CLI and job-loop defects.

Acceptance evidence: `.peaks/_runtime/2026-09-10-session-528a63/qa/e2e-acceptance-2026-09-10.md`.
