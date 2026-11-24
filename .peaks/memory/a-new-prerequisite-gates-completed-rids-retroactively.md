---
name: a-new-prerequisite-gates-completed-rids-retroactively
description: A new prerequisite gates completed rids retroactively
metadata:
  type: project
  sourceArtifact: .peaks/_runtime/2026-11-23-session-320f58/txt/handoff-s3.md
---

Adding a prerequisite with `backCompat` is not enough: the transitions honor the window, but
`peaks workflow verify-pipeline` — and the pre-commit artifact-contract leg, which checks EVERY
rid under `requests/` — treated a missing artifact as a hard violation, so a session's already
completed rids blocked the new slice's commit. The pipeline must soft-pass a missing artifact
inside the window (visible warning, `complete: true`). Separately, a verdict the prerequisite
accepts must be reachable by a correct repo: a non-frontend project must be `not-applicable`,
not `blocked`, or every feature slice deadlocks once the window closes. Before adding a gate,
test it against a session with completed rids and ask what a non-adopting repo gets.
