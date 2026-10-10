---
name: sub-agent-scratch-belongs-under-peaks-runtime-sessionid-rd-scratch-and-the-reason-is-functional
description: Sub-agent scratch belongs under .peaks/_runtime/<sessionId>/rd/scratch and the reason is functional
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-10-10-session-062f74/txt/handoff.md
---

Sub-agent scratch files belong under `.peaks/_runtime/<sessionId>/rd/scratch/`, never at a path
outside the repository. The reason is not tidiness. `.peaks/_runtime/` is gitignored
(`.gitignore` line 15 `.peaks/_runtime/`), so anything written there is invisible to BOTH
`git status` and the gate census, which reads `git ls-files`. A directory outside the repository
(`D:/projects/peaks-loop-scratch`) achieves the same invisibility, so stating only the *path* was
never enough: in this round one of five agents wrote its harnesses, registry hashes and
`batch2-evidence.md` to `D:/projects/peaks-loop-scratch` (created 2026-10-10 04:15) and violated
no rule, because no rule mentioned the boundary. State the boundary and the reason together, or
the next agent will satisfy the letter by leaving the repository instead of satisfying the intent.
