---
name: s1-shared-workspace-runtime-package-what-moved-and-what-stayed
description: S1 shared workspace-runtime package — what moved and what stayed
metadata:
  type: decision
  sourceArtifact: .peaks/_runtime/2026-11-05-session-af31e4/txt/handoff.md
---

`packages/peaks-loop-workspace-runtime` is the cross-repo runtime seam shared with peaks-harness.
It owns `state-root` (`defaultStateRoot` is the only place the `.peaks/_runtime` literal lives),
the lease store + lifecycle actions, the worktree porcelain parser, and an injected `RunGit` seam.
It must never read env/cwd/`session.json` and never import `node:child_process` — peaks-loop
supplies an `execSync` adapter, peaks-harness will supply a shell-free one. Host-side policy
(`--project` / `--session` / `PEAKS_SESSION_ID` / `session.json` precedence) stays in
`src/cli/commands/worktree-lease-session.ts`. The 72 pre-existing hand-rolled
`join(root,'.peaks','_runtime',sid)` sites are a ratchet baseline
(`tests/unit/services/session/session-runtime-composition-baseline.json`), not swept — full sweep
is a scheduled follow-up.
