---
name: a-job-tracker-is-a-log-of-checkpoint-calls-not-evidence-about-the-repository
description: A job tracker is a log of checkpoint calls, not evidence about the repository
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-10-session-528a63/sc/tracker-reconciliation-2026-09-10.md
---

On 2026-09-10 a survey of "what work is left" read `peaks job status` for every job and found roughly
**20 pending slices across four jobs**. Almost all of it had shipped. `feedback-4-items` (4 slices),
`j-codegraph-1m` (2) and `j-codegraph-lifecycle` (2) were **complete** — every slice's work was in the
tree, verified by commit — and `peaks-loop-optimization` was 11 of 12 done. The trackers said `0/N`
for all of them because **nobody ever called `peaks job checkpoint`**, and nothing surfaces that gap.
Separately, **all 70 dispatch records the project had ever written were `no-execution`** — zero had
ever been finalized (D2: `finalize` rejects its own record format), so every sub-agent dispatch also
looked like it never ran.

**Why:** the trackers are not wrong about their own contents — they are silent about what nobody told
them. `done: 0` is indistinguishable from "never started", and a future session reading it will
re-do shipped work, or spend a session re-deriving what is already finished. The failure is
one-directional and therefore invisible: nothing ever reports work as complete that isn't.

**How to apply:** before acting on any `peaks job status` / `peaks request list` — and *especially*
before reporting a backlog to the user — reconcile each claimed-pending slice against git
(`git log --oneline --all --grep=<label>`, `git log -S <string>` for a doc or command that should
exist). Mark nothing done without a commit that demonstrably contains it; leave unevidenced items
pending rather than inventing an outcome. At the end of any job, check `progress.json` matches
reality, and run `peaks sub-agent finalize --all-stale --outcome done --session-id <sid>` to clear
ghost dispatch records.
