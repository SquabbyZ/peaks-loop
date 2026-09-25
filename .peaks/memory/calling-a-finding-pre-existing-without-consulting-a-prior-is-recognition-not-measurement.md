---
name: calling-a-finding-pre-existing-without-consulting-a-prior-is-recognition-not-measurement
description: A finding labelled "pre-existing" with no prior consulted is recognition, not measurement — and a rule whose finding is a function of the artifact's own size can fire with zero behavioural change
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-25-session-0cf437/rd/rid-6f1df581-repair-1-handoff.md
---

An RD reported that `eslint` on its five changed files showed **10 messages, all pre-existing**. The
pre-commit ratchet then refused the commit: `tests/unit/services/lint/eslint-runner.test.ts went from
1 to 2 lint finding(s)`. Both halves of that sentence were wrong, in two different ways.

## 1. The snapshot was stale, and was reported as a property of a moving artifact

The same command prints **11** now. The number 10 is reproducible only as a **pre-crossing state**. The
file's effective line count went `267 (HEAD) → 311 → 353 → 401 at the third added case → 443`. The
`401` step is where it crossed the 400-line cap; the snapshot predates that. So **10 was true when it
was taken, and was then reported as a property of an artifact that no longer occupied that state.**

## 2. The classification was recognition, not measurement

Calling one finding "new" requires **a prior**. None was consulted — the message list was read and
judged by eye. And the prior was already committed: `.peaks/lint/gate-baseline.json` holds a per-file
count for **every** file, which is exactly what the ratchet itself compares. Comparing against it
prints `WORSE (1 -> 2)`.

> The method **could not** have returned the other answer. A check that cannot fail is not evidence.

## Why `max-lines` makes this unavoidable

Its finding is a **function of the file's own size**. It can fire with **zero behavioural change** — the
code can be identical and correct, and the rule reddens because the file grew. So for this rule class,
"the diff is semantically clean, therefore any finding is pre-existing" is not a weak argument, it is
**no argument at all**.

## How to apply

- **Never label a finding "pre-existing" without naming the prior you compared it to.** If the prior is a
  file, name it; if there is none, say there is none.
- Before believing a count, ask **what state the artifact was in when the count was taken**, and whether
  it is still in that state. Same shape as
  [[a-single-measurement-of-a-host-sensitive-command-is-not-a-fact-about-the-command]] and
  [[pnpm-version-varies-by-directory-so-a-probe-outside-the-repo-measures-a-different-pnpm]], on a third
  axis: not the host, not the toolchain, but the **artifact's own size over time**.
- When a size-dependent rule fires, the honest question is **"did the file get worse?"** — which needs a
  prior — not **"does the diff look clean?"**
- Practical gotcha from the same session: `eslint` **exits 1 whenever it reports anything**, so its JSON
  arrives on the thrown error's `stdout`, not on a success path.

Related: [[comparing-counts-across-rounds-guarantees-a-false-regression-report]],
[[a-count-of-new-tests-is-meaningless-until-both-sides-of-the-subtraction-cover-the-same-file-set]].
The fix in this case was to **split the file** (the ratchet's rule is "a file you touched may not get
worse; a new file must be clean"), and the 400-line cap was **kept** — raising a ceiling to pass a
ratchet turns a real finding into a silent one.
