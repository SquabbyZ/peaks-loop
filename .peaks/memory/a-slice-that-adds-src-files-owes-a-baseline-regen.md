---
name: a-slice-that-adds-src-files-owes-a-baseline-regen
description: a-slice-that-adds-src-files-owes-a-baseline-regen
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-parity.md
---

A commit that adds `src/**` files must regenerate `.peaks/lint/gate-baseline.json` before the next
tier run, or `tests/unit/standards` and `tests/unit/lint` go red for a reason unrelated to the current
diff. `64238afa` added four reviewer source files and left the baseline untouched; the next slice
inherited 2 standards failures and 1 lint failure (silent-warning 1291 vs 1295). The regeneration
added exactly the four rows and only lowered ceilings.

**Why:** `file-size-cap` and `scope-shadow-coverage` require a `files[]` row per counted file, and the
silent-warning population is recorded separately. A green commit gate does not mean the baseline is
current.

**How to apply:** after any commit that adds or removes `src/**` / `packages/**/src/**` files, run
`node .husky/peaks-gate-baseline.mjs`, confirm no ceiling rose, then run `tests/unit/standards` and
`tests/unit/lint` before attributing their red to the next diff.
