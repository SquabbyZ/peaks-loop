---
name: stage-new-files-before-regenerating-the-baseline
description: stage-new-files-before-regenerating-the-baseline
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-prereq.md
---

The gate baseline must be regenerated AFTER `git add`-ing any new file it should count. The census
reads `git ls-files`, which lists the index, so an untracked new test file is invisible; a regen
before the add produces a baseline that is stale the moment the file is committed, and the next tier
goes red for a file the baseline never saw.

**Why:** on 2026-10-19 a slice's RD reported the regen as owed because a regen then would still miss
its own untracked test. The correct sequence is stage → regen → tier → commit, with the baseline in
the same commit.

**How to apply:** `git add` the new files first, run `node .husky/peaks-gate-baseline.mjs`, confirm
no ceiling rose, then run the tier. Do not regenerate before staging.
