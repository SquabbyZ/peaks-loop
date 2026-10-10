# Fast-lane norm — the single source

> **advisory.** Nothing gates on this document. It is a judgement list, not a
> gate. Enforcement lives in each lane: peaks-code's fast mode enforces its own
> step switches (`peaks code plan --fast`), and `peaks-race-code` enforces its
> own completion proofs. Reading "stated here" as "enforced somewhere" is the
> mistake this line exists to prevent.

Two fast lanes share these two statements. If you find a **second copy** of
either one, that is drift — `tests/unit/standards/fast-lane-norm-single-source.test.ts`
fails on it. Two places that cannot be word-for-word identical should not have
been split in the first place.

## 1. The acceptance gate

`test pass + tsc pass + lint pass` = GO.

A single QA round, **no** repair loop. peaks-code's fast mode turns the repair
loop off; peaks-race-code has no separate QA window to loop with.

## 2. When a task is not a fast-lane task

Any one hit means the task does not belong in a fast lane. **Each row is
annotated with how mechanical it actually is** — only row 6 is machine-checkable,
and the rest are judgement calls, which is worth knowing before treating this
list as if it decided anything on its own.

| # | Risk surface | Machine-checkable? |
|---|---|---|
| 1 | authn / authz / credentials / secrets handling paths | no — judgement |
| 2 | database schema or migrations | partly — the path can be matched (`migrations/` and the like) |
| 3 | public API surface (exported signatures change) | partly — codegraph / export-surface diffs help |
| 4 | concurrency / transaction semantics | no — judgement |
| 5 | dependency upgrades carrying API changes | partly — the `package.json` diff is mechanical, the API-change call is not |
| 6 | change size past a threshold | **yes** — the threshold is each lane's own to set |
| 7 | behaviour that cannot be believed from "run the tests once" | no — judgement |

**This list does not say what happens on a hit.** That belongs to each lane:
peaks-code's answer is the full workflow, and peaks-race-code's answer is
one-way escalation to peaks-code.
