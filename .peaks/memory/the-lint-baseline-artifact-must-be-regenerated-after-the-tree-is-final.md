# The lint baseline artifact must be regenerated after the tree is final, and it must be committed

**WHAT I HIT (2026-10-25, rid-t5-release-packaging-hotfix).** I added one test file to
`tests/unit/release/`. The lint baseline `.peaks/lint/gate-baseline.json` counts the files
that have no row of their own (`shadow.measuredFiles`), so the count went 881 → 882. The
`standards` gate read the live census and the artifact and refused:

```
882 counted file(s) have no row, but shadow.measuredFiles claims 881
— the omission set and the shadow block disagree
```

**THE PART THAT COST THE TIME.** I regenerated the artifact first (the generator wrote 882
and reported `monotonicity: every ceiling held`). Then I ran the test suites. After the run,
the artifact was **back to HEAD's bytes** — 881 again. Something in the test session put it
back, and I could not name the writer from the outside; the repo's own red-line test even
refuses with `git checkout HEAD -- .peaks/lint/gate-baseline.json` as the *remedy* for a
working copy that differs from HEAD.

**THE RULE THAT FOLLOWS.**

1. **Regenerate the baseline AFTER the tree is final** — i.e. after the product commits are
   already on HEAD. The generator's census reads `git ls-files`, so the file set must be the
   final one, not the one you are about to create.
2. **Commit the regenerated artifact as its own boundary**, right after the code it
   describes. The repository's own convention already says this: *"a baseline measured
   against a tree that does not exist yet would be a measurement of the wrong thing."*
3. **A test run can restore the artifact to HEAD's bytes.** Once HEAD carries the
   regenerated baseline, that restore is a no-op — the artifact stays at 882. Before the
   commit, the restore puts it back to 881 and the `standards` gate fails on the count even
   though nothing about the code is wrong. That ordering is the whole difference between a
   red gate and a green one.

**WHAT IS NOT A FIX.** Do not edit `shadow.measuredFiles` by hand, and do not leave the
artifact dirty in the working tree "because it will be regenerated later". The count is a
measurement; it changes when the population changes, and the generator is what is allowed to
say so.

**HOW TO SEE WHAT THE GENERATOR DID.** `node .husky/peaks-gate-baseline.mjs` prints the
comparison it made and the monotonicity verdict before it writes:

```
WARNING: shadow moved up: measuredFiles 881 -> 882 — the boundary exempts it; nobody fixed it
  compared: this run 882 files, 767 findings, 257 errors, 34 over-cap, 11430 excess lines
            against HEAD's 881 files, ...
monotonicity: every ceiling held — nothing rose and nothing dropped
```

The shadow move is *exempted* by the boundary, so it does not block the write. The ceilings
are what must not move, and they did not.
