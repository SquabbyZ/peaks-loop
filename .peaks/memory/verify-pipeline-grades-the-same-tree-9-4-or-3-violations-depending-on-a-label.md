---
name: verify-pipeline-grades-the-same-tree-9-4-or-3-violations-depending-on-a-label
description: verify-pipeline grades the same tree 9, 4 or 3 violations depending on a label
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-29-session-b7cf21/txt/handoff.md
---

`peaks workflow verify-pipeline --rid <rid>` with no `--type` demanded 9 artifacts (PRD handoff,
code review, security, perf, QA test-cases, QA test-report, two states, Gate H). With
`--type config` the same tree demanded 4; with `--type docs`, 3. The recorded `requestType`
defaults to `feature` when `peaks request init` is skipped — and `request init` is skipped whenever
the role envelope already exists at the path the leaf wrote to, because init refuses on collision
(`REQUEST_INIT_FAILED: A request artifact with id … exists`). So a slice inherits the strictest
label by accident and the loosest by convenience, and neither reflects what the diff did.

**How to apply:** state the type out loud before dispatching, and read it back from the record
after the first transition — the same tree reading as 9 violations and as 4 is a gate graded on a
label. Choosing `docs` to shrink the required set is the failure this repo names
"a gate that verifies the label instead of the thing"; choosing the honest type may mean producing
artifacts the type matrix does not even require. Both are better than the accidental default.
