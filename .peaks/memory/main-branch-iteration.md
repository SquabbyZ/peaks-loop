---
name: main-branch-iteration
description: For this project, future iterations should modify main directly instead of creating worktrees.
metadata:
  type: feedback
---
<!-- peaks-feedback-promoted: layer=A -->
For future iterations in this project, do not create worktrees by default; modify directly on the main branch.

**Why:** The user explicitly prefers direct main-branch edits for subsequent iterations.

**How to apply:** Unless the user explicitly asks for a worktree or project instructions require one, continue work in the main worktree and avoid proactive EnterWorktree flows.
