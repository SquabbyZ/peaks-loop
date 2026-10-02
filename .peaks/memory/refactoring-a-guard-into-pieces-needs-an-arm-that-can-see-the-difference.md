---
name: refactoring-a-guard-into-pieces-needs-an-arm-that-can-see-the-difference
description: splitting a guard (or any code no linter can read) is only accepted on an equivalence arm that has been shown discriminating — wave 9, 2026-10-02
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-29-session-b7cf21/rd/requests/2026-10-02-wave9-generator-split-repair1.md
---

Three slices of wave 9 split the ratchet's own files (gate entry 1019 → 102 + 8 modules; monotonicity 672 → 125
+ 6; generator 799 → 106 + 10), and each one produced the same argument in a new form: **the interesting risk of
refactoring a guard is behaviour, and behaviour is the one thing this repo's instruments cannot see.** `.husky/` is
outside the tsconfig include set and outside eslint's `parserOptions.project` — all 9 to 14 of its files fail to
parse under the gate's own invocation — so an undeclared import is not an error, a moved refusal sentence is not a
diff, and `eslintCoverageGapFiles` stays 0 because the files were never asked about. Twice in a row a split
shipped a `ReferenceError` in a code path nothing spawns: `staged` mode (the mode the commit hook actually runs,
and no test invokes it with an in-scope path because `lint-staged` exists only inside a real commit), then
`artifact.mjs:80` reading `scope`, reachable only through a fixture's injected ceiling row.

What made the third slice acceptable was not a green suite. It was an equivalence arm, and then a demonstration
that the arm can fail. Two fixture repos with identical inputs — one running `git show HEAD:` of the generator
plus its real dependency closure, one the split — byte-identical stubs for the measuring legs, real prettier, and
a comparison of exit code, artifact bytes modulo `generatedAt`, stdout **and stderr** across the seed path, the
legitimate second run, and each of the three §2.33 attacks; each side asserting an explicit reference verdict, so
"both crashed identically" cannot pass. Then three mutation controls: drop a refusal → exit code and bytes red;
reflow one refusal sentence → **only** stderr red; reword one note line → **only** bytes red. That pairing is the
standard: an arm must see the difference it claims to see, and nothing else.

**How to apply:** when refactoring anything the type-checker and linter cannot read, write the behavioural
comparison first, and prove it discriminating before the split is called done. Reflowed output counts as a
regression — for a gate, stderr *is* the interface the operator reads. And treat a comment inside the source
saying "proven" as the claim under test, never as evidence: the generator's header asserted a fixture proof that
no test performed, and it took an independent pass to notice the tree did not even compile
(`tsc` exit 2, and 8 red arms, 7 of them one real `ReferenceError`). See [[a-guard-that-reads-the-thing-it-guards-is-not-a-guard]],
[[feedback-verify-subagent-claims]] and backlog §2.37 / §2.39.
