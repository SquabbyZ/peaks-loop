---
name: a-ceiling-row-is-born-measured-before-it-is-committed
description: a seeded ceiling row makes "HEAD equals the canonical list" temporarily false by design, and a multi-cycle repair pass needs its dependency order written down — both measured on rid `2026-10-02-hooks-size-rows`
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-29-session-b7cf21/rd/requests/2026-10-02-hooks-size-rows-repair3.md
---

The hooks-rows slice looked like the simplest of the day — two new ceiling rows for a directory nothing
measured — and needed three repair cycles because of an ordering nobody wrote down until it bit.

The first leaf died at the harness turn limit (150 turns, 166 tool calls, no envelope), leaving `tsc` at 14
errors. Cycle 1 was contracted as **one character** (a `describe` title containing an apostrophe inside
single quotes) and the leaf fixed it and then **stopped**, reporting "tsc is 9, not the 0 your brief predicted"
rather than widening its write set. That report is where the dependency chain became visible: while
`tscErrors` measures non-zero, the generator refuses to write, so the new rows cannot be seeded, and until they
are seeded 14 arms that read the published artifact cannot pass. The deadlock is not a bug in anything — it is
what a ratchet that gates its own regeneration does. Cycle 2 finished the never-written helper
(`walkHooksScope` imported twice, defined nowhere), cycle 3 fixed arms I had accidentally excluded from cycles
1-2 by naming too narrow a write set.

**The invariant that came out of it is the durable part.** `baseline-monotonicity.test.ts` compared HEAD's
ceiling keys to the canonical list with **set equality**, and adding rows to the canonical list broke it while
the artifact was seeded and uncommitted. The correct permanent shape is: the published artifact equals
`CEILING_KEYS` exactly, and HEAD is a **subset** whose only tolerated difference is *missing* rows — an extra,
renamed, or non-integer row in HEAD is a defect in either commit state. The reason is structural: every
ceiling row is born in exactly this configuration, measured and written before HEAD knows about it. That is
§2.35's whole purpose, and this slice was its first real exercise — the generator was run twice before the
commit, both runs exited 0, both printed the rows under `NEWLY SEEDED`, ceilings and `files` tables
byte-identical between them. Had the deferral not been built the day before, the second run would have refused
and told the operator to `git checkout` the artifact, i.e. to delete two legitimate rows.

Two rules to carry forward:

1. **When a slice adds rows to a canonical list, grep for every arm that asserts the list's length or
   equality before dispatching**, and put the HEAD-may-lag invariant in the brief. My briefs specified the new
   rows, the caps, and the artifact's 13→15 consequence for the *guard*, but not for the *tests that compare
   against HEAD* — so the third cycle cost a full dispatch.
2. **Contract repairs with a dependency order stated up front** ("syntax → type layer → seed → artifact-reading
   arms"), and let the last cycle's write set be defined by the error list, not by which leaf wrote which
   file. A write set inherited from the previous contract is how a correct fix gets split across three passes.

Also worth keeping: the disjointness the whole design rested on was asserted, not argued — an arm whose only job
is "an over-cap hooks file moves the hooks rows and leaves `fileSizeOverCap` alone", plus an independent
recursive `readdirSync` walk that never touches git, proven independent by a throwaway repo where the walk saw
3 files and `git ls-files` saw 2. See [[feedback-verify-subagent-claims]] and
[[a-guard-that-reads-the-thing-it-guards-is-not-a-guard]].
