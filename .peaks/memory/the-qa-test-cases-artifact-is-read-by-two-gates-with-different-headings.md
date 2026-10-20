---
name: the-qa-test-cases-artifact-is-read-by-two-gates-with-different-headings
description: The QA test-cases artifact is read by two gates with different headings
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-10-20-session-c620de/txt/handoff.md
---

`peaks request transition`'s artifact contract requires the literal section `## Test cases`,
while `peaks scan acceptance-coverage` parses `## Test Case:` headings plus
`- **Acceptance:** A1` fields. A file that satisfies one fails the other, and each gate's
error names only its own missing marker. Satisfy both: one `## Test cases` section, then
`## Test Case: TC-n` blocks carrying `- **Acceptance:**`. Cost two round trips on
2026-10-20 (QA normalized to `## Test Case:` and broke the contract gate; the orchestrator
re-added `## Test cases`).
