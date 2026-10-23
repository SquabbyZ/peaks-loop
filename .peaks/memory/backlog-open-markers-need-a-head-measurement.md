---
name: backlog-open-markers-need-a-head-measurement
description: backlog-open-markers-need-a-head-measurement
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff.md
---

The backlog's OPEN markers are not machine-checked. On 2026-10-18 three were already fixed at HEAD:
§14.1 (`988c6197`), §13.3's first half (`d62eda51`), and §16's backCompat enforcement (`0cfc25c0`).
A reader who treats the heading as the state re-implements finished work.

**Why:** §9.40 names the class; the section-16 revision that shipped the fix did not update the
section it was about.

**How to apply:** before turning any backlog item into a slice, run the item's own measurement at
HEAD (the `git log -S` or the cited command). Correct the marker in the same pass. A heading is a
claim, not a result.

**2026-10-23 — the drift is still shipping, and it now hides in a *new* session's own section.**
Triaging §18–§21 (the 2026-10-21 → 10-23 sessions) for a slice queue, the same failure appeared
again in a section written six days after the rule above was sedimented: **§21.5's heading reads
"found 2026-10-23, measured" with no closure marker, while its body says the message was changed in
that very session** (`build-integrity: NOTHING WAS COMPARED — 0 source-bearing package(s) of N
package(s) considered`, deliberately not containing `build-integrity: OK`). §21.3 and §21.4 say
"**Fixed in this session**" in prose rather than in a bold marker, and §21.11's fix landed as
`c5691d56` with the entry untouched. **A Rule-B marker scan alone therefore over-reports the open
set**, and so does a `git log` check alone — §21.5's fix is not a commit message, it is a body
sentence.

**The working method that caught all four**: for every candidate, read the item's **body
conclusion**, not its heading — then cross-check the conclusion against `git log` for the cited
files. Items whose heading lacks a marker but whose body says "Not fixed in this session" are the
real open set; items whose body says "fixed"/"changed"/"IMPLEMENTED" are closed even without a
marker. A third pass — scanning later sections for `§N.M` cross-references — is what revealed that
§2.37 had already been decided elsewhere and §2.46 is owned by §9.45.

**Corollary added — and it is about the MEASUREMENT, not the number.** On 2026-10-23 I re-measured
§12.4's file-size numbers and "corrected" them: I counted with PowerShell's
`Get-Content | Measure-Object -Line`, which **skips blank lines**, and got 278/274 — so I recorded
in this very memory that §12.4's numbers "had expired" and let a slice believe it had no split
precondition. **§12.4 was right.** Under the convention the repo itself pins
(`.peaks/lint/gate-baseline.json` → `fileSizeLineConvention` =
`readFileSync(f,'utf8').split('\n').length`) the files are **297 / 299 / 159**, i.e. 3 and 1 lines
of headroom against the 300 cap — the opposite of what I had written. The sub-agent that was
running the slice caught it by measuring independently and reported the discrepancy instead of
trusting the number I had handed it.

The transferable lesson is not "backlog numbers rot". It is: **a number that gates a decision must
be taken with the convention the repo pins, not with whatever your shell defaults to** — and the
two disagree by exactly the blank lines, which is precisely where a cap lives. A wrong measurement
is worse than a stale one, because a stale number at least disagrees with the code and gets
re-measured, while a wrong measurement looks like a finding and gets cited.
