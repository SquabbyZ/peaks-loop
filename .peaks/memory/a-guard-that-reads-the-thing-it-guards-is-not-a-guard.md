---
name: a-guard-that-reads-the-thing-it-guards-is-not-a-guard
description: a guard's trust anchor must not be the artifact it is asked to police, and a refusal whose printed remedy performs the weakening is a second defect — both measured in C wave 8 and its repair cycle
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-29-session-b7cf21/rd/requests/2026-10-02-monotonicity-head-anchor.md
---

C wave 8 spent half its life being the fix for §2.27: `peaks-gate-baseline.mjs` wrote "every ceiling may only
go DOWN" into its own artifact while containing no comparison, so a regeneration raised `prettierUnformatted`
0 → 7 and exited 0. The guard landed, red-first arms passed, the repo-wide suite passed, `peaks-gate repo`
passed, and I wrote in the commit message that the ratchet now refused a raise. Out-of-band review then walked
past it three times in a row, and the reason was structural rather than a missing arm: **the guard read its
previous ceilings from the working-tree artifact — the very file a weakening is edited in.** Measured against
the shipped code: delete a row from that file and a raise is laundered as `NEWLY SEEDED` (exit 0); inflate a
row and the same raise prints `CLEARED` (exit 0); empty `"ceilings"` and all thirteen rows re-seed and the
`--seed` trip never fires, because the JSON parses. Worse than any of them: the downstream gate that *does*
fail closed on a missing row prints `Regenerate it: node .husky/peaks-gate-baseline.mjs` — so an operator
obeying the refusal performs the attack. The repair anchored the comparison to `git show HEAD:<artifact>` and
kept the on-disk copy as a second trip that refuses a lift or a deletion and explicitly allows a lowering.

**How to apply:**
- When you build a guard, ask what it reads as "truth" and whether the party it constrains can edit that
  source. If the answer is the file it guards, the guard is a note. Same test for any self-check: a baseline
  generator, a lint waiver list, an allow-list, a snapshot fixture — all are anchors an editor can move.
- Read a refusal's **instruction**, not just its exit code. If following the printed remedy would cause a
  different weakening, file it as its own defect; it is not a cosmetic issue. That loop is how §2.33 became
  two findings and why the fix's own message still needs work (§2.35: a legitimately-added row is refused on
  the second regeneration, and the remedy it prints would delete the row).
- Run the review on the staged change, before committing. This wave it changed the commit message, not the
  code — and the "the ratchet now refuses" sentence would otherwise have shipped as a false claim in the
  history of a repo whose whole thesis is that a green gate proves nothing.
- Suspect your own instrument before the code, for the third time in this campaign: my probe printed
  `undefined` inside the refusal text and it was *my* call omitting the `outRel` argument; my first census
  reported a phantom `<anonymous>` offender because my scanner split nested arrows that the product's scanner
  folds; and `cmd | tail` gave me `EXIT=0` on a run that exited 1. Re-measure with the tool the code actually
  specifies, and check what your pipeline's exit status belongs to.
- A leaf that dies at the turn limit is judged by the tree, not the report: 36 arms green across its three
  files, the demanded arm names present by grep, idempotent regeneration on the real repo — so the work was
  kept, and its red-phase numbers were recorded as "documented, not verified" rather than retroactively
  blessed. See [[feedback-verify-subagent-claims]].
