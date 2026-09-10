---
name: removing-a-tool-removes-the-guarantees-it-made-implicitly
description: Removing a tool removes the guarantees it made implicitly
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-10-session-528a63/txt/handoff.md
---

`spawnDaemon` launched the daemon via `npx --package playwright@<pin>`, which did two jobs: it
launched the process **and it pinned the Playwright version by construction**. It was removed to stop
it allocating a console window on Windows and to save 2.8–7.1 s of a 3.1 s cold start. That forced a
hand-rolled package-resolution scan — and the replacement trusted PATH and read the version from
metadata inside the tree it was about to execute. Security reproduced code execution with a planted
`playwright@9.9.9-alpha` on PATH, reachable from `peaks web status` alone.

**Why:** dependency-provisioning tools encode guarantees nobody writes down. Replacing one with
bespoke code silently moves those guarantees into code that was never asked to provide them.

**How to apply:** before removing a tool or dependency, list what it was implicitly guaranteeing —
version pinning, integrity, ordering, atomicity — and make each an explicit, tested requirement of
the replacement. A hand-rolled replacement for a trust boundary needs a threat model, not a scan.
