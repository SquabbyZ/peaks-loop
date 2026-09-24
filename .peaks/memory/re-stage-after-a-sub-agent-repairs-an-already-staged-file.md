---
name: re-stage-after-a-sub-agent-repairs-an-already-staged-file
description: Re-stage after a sub-agent repairs an already-staged file
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-09-24-session-b714c7/txt/handoff.md
---

The git index keeps the **pre-repair** bytes. If a sub-agent edits a path that is already staged, a commit made
afterwards without a fresh `git add` ships the version that was just rejected — and `git status` shows the path as
`AM`, which reads like progress rather than as a hazard.

Demonstrated in `rid-muf2sasw`: the orchestrator staged all 12 paths, the gate blocked the commit, and
`rd/rid-muf2sasw-repair-3-handoff.md` §5 records that the index still held the **pre-repair** module —
`git show :scripts/packages-build-prerequisite.mjs` was the *before* side of the RD's own equivalence control, and
§0 states plainly "index untouched". The RD could not fix this itself (sub-agents are forbidden to `git add`), so
re-staging is the **orchestrator's** step, not a sub-agent's. Re-stage every path a repair touched before
committing, and re-run the gate afterwards rather than trusting the earlier green.
