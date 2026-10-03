---
name: a-leg-must-not-choose-its-own-population
description: an enforced row must speak for the same named, sourced, tracked set as every other row — a leg with its own directory walk hid 17 real findings in shipped packages/*/src, and widening it made the ratchet refuse a rise it could not attribute — measured on rid `2026-10-03-silent-warning-scope`
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-29-session-b7cf21/rd/requests/w10-silent-warning-scope.md
---

# A leg may only report a number for a population it can name and defend

**Date:** 2026-10-03 · **Session:** 2026-09-29-session-b7cf21 · **Rids:** `2026-10-03-silent-warning-scope` + `…-repair1`
**Docs:** `.peaks/docs/lint-gate.md` §4y, `.peaks/docs/backlog.md` §2.43 / §2.49

## The rule

An enforced row must speak for a population it can **name, source, and defend as identical to the one the
other rows speak for**. Two halves, and the second one is what took a whole slice to learn:

1. *Name it.* The number and the size of the set must appear together. `gate repo` prints
   `943 file(s) scanned, == the enforced scope (git ls-files <scope dirs>)`, not `49 (ceiling 49)`.
2. *Do not let the leg choose its own set.* `silent-warning` carried `SCAN_ROOTS = ['src']` inside the
   detector — a self-chosen 905-file walk — while the gate decided 943 for two slices. Nothing crashed,
   nothing went red, and **17 real swallows in shipped `packages/*/src` were counted by nobody.**

## Why a filesystem walk is the wrong instrument, even when it has the right count today

The list every other leg uses is `git ls-files` filtered by the published scope rule. A walk of a directory
list differs in two ways that both bite: it sees **untracked** files, so a scratch file can inflate a row;
and it cannot see that it disagrees with the gate, so a divergence shows up as a footnote
(`Recorded, not reconciled`) instead of a refusal. Widening `SCAN_ROOTS` would have fixed this slice's gap
and left both failure modes in place. The fix was structural: the leg is *handed* the tracked list, and a
population mismatch refuses.

## The corollary that made the ceiling rise legal

Widening a leg raises its ceilings with **zero new debt** — the debt was always there, unlooked-at. The
ratchet refused (correctly), and the escape hatch could not engage: `--rescope` compared `scope.dirs`,
which had not changed. So the guard was taught to compare the **whole `scope` block**
(`.husky/baseline/leg-scope.mjs`), making *"one leg's population moved"* a boundary event of the same kind
as a directory list moving, with an absent prior population read as **unknown, never zero** — a missing key
must not make a rise look like a fall from nothing.

Measured, on the real tree: no-flag → exit 1, naming the leg, `unknown → 943`, and both rises (41→49,
59→68), artifact byte-identical at `sha256 85e8534…884f`; `--rescope` → exit 0 with exactly two ceilings
moved, the other thirteen byte-identical, `CEILING_KEYS` still fifteen.

## Related

`a-ceiling-row-is-born-measured-before-it-is-committed` (the artifact is a snapshot of the index, which is
why a convergence commit must stage before it generates — §2.49 records 552 → 558 → 561 → 564 from one day
of getting the order wrong), `a-guard-that-reads-the-thing-it-guards-is-not-a-guard`.
