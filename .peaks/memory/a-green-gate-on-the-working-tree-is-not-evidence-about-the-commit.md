---
name: a-green-gate-on-the-working-tree-is-not-evidence-about-the-commit
description: a green gate on the working tree is not evidence about the commit
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-22-session-b0e6e2/txt/handoff-t1-backlog-2026-10-23.md
---

Measured 2026-10-23 (T1 backlog campaign, orchestrator, at the commit gate). Every ratchet in this
repository measures its population with `git ls-files`, so an UNTRACKED file is invisible to all of
them. The batch under review had nine new files and six of them were untracked when the gate ran.

The gate's own output, with the working tree as it stood: `eslint findings 1698 (ceiling 1696)`,
`of which errors 561 (ceiling 560)`, `silent-warn return-null 44 (ceiling 44)`, `comment narrative 22
(ceiling 22)`. Three of those regressions were introduced by THIS batch and none of them was visible
while the files were untracked: `src/cli/commands/best-practice-scan-helpers.ts` carried a new
`@typescript-eslint/restrict-plus-operands` error, `src/cli/commands/best-practice-scan-collision.ts`
a new `catch-return-null` silent warning, and
`src/services/doctor/doctor-service/checks/skill-reference-parity.ts` a new `max-lines-per-function`
(51 over 50) and `complexity` (11 over 10).

The same blindness runs the other way: the two new `src/` files were refused with "the baseline names
no row for it", because the gate will not widen a row for a file it cannot yet see. The remedy the gate
itself names is "stage it first, then regenerate".

**Why.** A ratchet that may only go DOWN turns every new file into a liability the moment it is
tracked. The generator refuses to raise a ceiling — it is anchored to
`git show HEAD:.peaks/lint/gate-baseline.json` — so a regression cannot be baselined away; it has to
be fixed in the code.

**How to apply.** Before calling a batch committable, measure the population the COMMIT will have,
not the population the working tree has: stage the new files, regenerate the baseline with the
repository's own generator, and run the gate again. Read the ceiling ROWS, not the exit code — a row
that is exactly AT its ceiling is one new line away from red, and four rows in this run sat exactly at
theirs. One scope fact worth keeping: the ENFORCED lint scope is `src/**` plus `packages/*/src/**`
(`.husky/lint-scope.mjs`); `tests/**` and `scripts/**` are measured as shadow rows and are not gated,
so a new test file cannot break the eslint, silent-warning or comment-hygiene ceilings.
