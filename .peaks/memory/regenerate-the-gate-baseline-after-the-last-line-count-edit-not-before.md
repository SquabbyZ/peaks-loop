---
name: regenerate-the-gate-baseline-after-the-last-line-count-edit-not-before
description: Regenerate the gate baseline after the last line-count edit, not before
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-11-05-session-af31e4/txt/handoff.md
---

`.peaks/lint/gate-baseline.json` publishes measured numbers that `tests/unit/standards/`
asserts against the live census. A `node .husky/peaks-gate-baseline.mjs --rescope` run taken
BEFORE a later edit that changes a file's line count leaves the file red — measured here as
`file-size-cap` failing `expected 11435 to be 11430` after a 5-line shrink that landed after the
regeneration. Sequence rule: shrink/edit first, regenerate last, then re-run
`file-size-cap` + `staged-size-leg` + `lint-file-list-parity` before declaring the slice green.
Also: `staged-size-leg` tolerates a file already over cap only while it does NOT grow, so a test
file at exactly its previous line count is legal with zero headroom.
