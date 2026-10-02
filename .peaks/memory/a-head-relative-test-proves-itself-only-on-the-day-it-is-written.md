---
name: a-head-relative-test-proves-itself-only-on-the-day-it-is-written
description: a regression test that anchors on HEAD (or any moving tip) validates its own refactor at authoring time and self-destructs the moment the refactor commits — wave 9, 2026-10-02
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-29-session-b7cf21/rd/requests/2026-10-02-generator-equivalence-anchor.md
---

Wave 9 split the ratchet's own directory into 24 modules: `.husky/peaks-gate-baseline.mjs` was a 799-line
top-level-`await` script, so its regions had to become functions — a shape change, not a line move, which
means the only acceptable evidence is behavioural. The harness built two fixture repos with identical inputs,
one running the split generator, one running `git show HEAD:.husky/peaks-gate-baseline.mjs`, comparing exit code,
artifact bytes modulo `generatedAt`, stdout and stderr across five states, with three mutation controls (drop a
refusal → exit code and bytes red; reflow a refusal sentence → stderr only; reword a note → bytes only). That
harness is correct and it is also the thing that broke.

`HEAD` was the pre-split file while the slice was uncommitted. The commit that landed the split made `HEAD` the
split file, so the reference side began staging a generator that imports `.husky/baseline/` while the harness
deliberately excluded that directory: 11 arms dead with `Cannot find module '…/head/.husky/baseline/anchor.mjs'`.
Discovered not by the author but by the *next* slice, whose run turned up reds it could prove pre-existing by
comparing against a clean tree. The fix (`f0c42d57`) pins the pre-split sha and adds arms asserting the anchor
still resolves and is monolithic and that `HEAD` is split and differs from it — so the failure mode is a
sentence, not a stack trace.

**How to apply:**
- If a test compares new code against "the previous version", the previous version needs a **name**: a pinned
  sha, a tag, or a committed fixture. Never `HEAD`, never `main`, never "as it was before this change" — those
  are true the day you write them and false the day you merge.
- Give the anchor its own assertion. The property the comparison depends on ("the reference file is monolithic")
  is a fact about history, and history moves; assert it, and make the failure say what moved.
- Watch the trap one layer down: an assertion that a **dependency closure** was unmodified versus `HEAD` was
  broken by the *next* slice's legitimate working-tree edit. Narrowed, with measurement, to "the two fixtures'
  closures are byte-identical" — the property the test actually needs. Narrow with a reason and a comment;
  never by dropping the arm.
- Price the fixture before you make it. Storing the pre-split generator as a test fixture would have added a
  799-line `.mjs` under `tests/`, inside the census scope at cap 500 — **299 excess lines added to the very row
  this wave was descending** (1,701 → 0). Sometimes the correct reason not to persist a snapshot is arithmetic.

What the wave bought: `.husky/` measured by nothing → measured by two rows now at zero (`fileSizeHooksOverCap`
0, `fileSizeHooksExcessLines` 0 over a 33-file scope), with `fileSizeOverCap` 162 and `fileSizeExcessLines`
54,318 unmoved through all four convergence runs, and `file-size-hooks-zero-floor.test.ts` proving new debt is
the only thing that can redden them. See [[refactoring-a-guard-into-pieces-needs-an-arm-that-can-see-the-difference]]
and [[a-guard-that-reads-the-thing-it-guards-is-not-a-guard]].
