---
name: an-installed-build-whose-version-string-matches-the-worktree-can-still-be-missing-every-new-file
description: An installed build whose version string matches the worktree can still be missing every new file
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-10-session-062f74/txt/handoff.md
---

PATH resolution is not a build check. On this host `which peaks` resolves to an nvm hardlink shim
that points at `.../nvm/installs/v24.12.0/node_modules/peaks-loop`, not at the worktree's
`bin/peaks.js`. Both the installed package and the worktree report `4.1.3`, so the version string
cannot distinguish them — the installed package's mtime was 2026-10-10 00:04 while worktree HEAD
was 2026-10-10 07:53, with 8 unpushed commits between them (that is the count at measurement time,
HEAD then `2ef89475`; the drift only grows as more commits land without an install). Measured
drift: those 8 commits added
161 files under `src/`, and 161 of 161 are ABSENT from the installed `dist/`. The drift is bounded
to exactly those commits (the earlier `loop-eval-*` split IS present in the installed dist), so
this is not "the whole package is old". Consequence: every `peaks …` call made that round executed
a pre-split build, so any regression the split introduced was completely invisible, and the local
end-to-end coverage that looked present was zero. Gate readings (`.husky/*.mjs` run from the
worktree) and on-disk orchestration state are unaffected. Before believing a local e2e pass, prove
which build ran — resolve the shim and diff the file set, do not read `--version`.
