---
name: a-wave-is-accepted-by-the-total-that-its-leaves-cannot-see
description: a wave is accepted by the total its leaves cannot see — reconcile the sum of leaf deltas against the combined-tree measurement, and sweep the tree by shape for what no row counts
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-29-session-b7cf21/rd/requests/2032-2026-10-01-c-wave7-excess.md
---

C wave 7 drove `fileSizeExcessLines` 60,271 → 54,318. Four leaves each reported "my file's excess is now 0",
and the wave was accepted only because the **sum of their stated deltas equalled the measured ceiling drop**
to the line: 1,897 + 1,558 + 1,285 + 1,213 = 5,953 = 60,271 − 54,318, with both ends of the ceiling read out
of the artifact rather than recalled (`git show 78f764cb^:.peaks/lint/gate-baseline.json` vs the file now).
The census scope moved the same way and had to be decomposed before it could be trusted: 1,444 → 1,474 while
debt fell. `git show --numstat` said 29 new in-scope files, not 30; the missing one was the previous slice's
own leg test, which the census counts only once it enters the index, because the census walks
`git ls-files`. A total that reconciles *after* you explain the residue is a measurement; a total that
reconciles because you bent the residue is a story.

Two things the wave committed that no gate could see, both found by sweeping **by shape** rather than by
`git status` (the tree was clean — the junk was tracked):

- five zero-byte `final-review-service-*.err` files at the **repository root**, leaf `2>` captures redirected
  relative to cwd, names matching w7-1's five new suites. `.err` is outside every lint scope and outside the
  file-size census, and `git status` cannot see a file that has been committed. The check that found them is
  `git ls-files | grep -v "/"` plus "which tracked files are 0 bytes".
- a hygiene command that vouched for itself. `peaks job subagent-cleanup --batch-id …` returned
  `{"cleaned": true}` for all six batches and changed nothing on disk (`find .peaks/_sub_agents/<sid>/ -type
  f -mmin -10` → empty; `active-dispatches.json` still 38 entries with all six listed). Its pending set is an
  in-memory `Map` (`src/services/job/subagent-job-wrapper.ts:32`) and the CLI builds a **new** wrapper per
  invocation (`src/cli/commands/job-commands.ts:449`), so the "nothing was pending" branch *is* the success
  branch. The real closure is `peaks sub-agent finalize --batch <id> --outcome done`, which took the ledger
  38 → 32 and flipped those records `queued → done` — both re-counted after the call, not believed from it.

The rid's `qa-handoff` transition then refused with **5 missing artifacts** (`rd/code-review`, `prd/handoff`,
`audit/perf`, `rd/karpathy-review`, `qa/test-cases`). None were fabricated; the bypass was recorded with
`--allow-incomplete --reason` naming what exists instead (five per-leaf records, the orchestrator-run legs,
the reconciliation above). Worth knowing that the same transition needed **nothing** for the sibling rid,
whose `--type config` exempts it from the review fan-out — so the artifact set a gate demands is decided by a
field the orchestrator filled in when it ran `request init`, not by what the wave actually did.

**How to apply:** before accepting a wave, write the leaf-level deltas in one column and the
combined-tree delta in another, and make them balance in public; keep a shape-based sweep (root-level tracked
files, 0-byte tracked files, filenames matching a leaf's targets) in the convergence checklist next to
`git status`; never report a hygiene command as done without re-counting the ledger it claims to have
cleaned; and when a transition refuses for genuinely-absent evidence, record the refusal rather than
producing the evidence in the shape the gate wants. Also: `git` writes `warning: in the working copy of …`
to **stdout** here, so a JSON parse of a peaks command must skip to the first `{` — that line, not the
envelope, is what broke two of my own reads.
