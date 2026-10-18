---
name: two-prerequisites-may-share-a-path-if-each-names-its-requirement
description: two-prerequisites-may-share-a-path-if-each-names-its-requirement
metadata:
  type: decision
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-prereq.md
---

`TEST_CASES` and `UNIT_TESTS` both require `qa/test-cases/<rid>.md`. That is not a defect by itself:
a missing heading and a missing test idiom are DISTINCT requirements on the same document, and
`TEST_CASES` does not own that path at `rd:qa-handoff` (only `UNIT_TESTS` does), so the duplicate
`mustContain` is load-bearing. Splitting onto two paths would change the producer contract for every
slice; the slice rejected it and kept the shared path.

**Why:** the original complaint was that an existing file was reported as missing, not that two
requirements shared a path. Fixing the report is the surgical change.

**How to apply:** when two entries share a path, make each violation name its own requirement and
the refusal distinguish absent from invalid. Split the paths only if the requirements genuinely
belong to different artifacts.
