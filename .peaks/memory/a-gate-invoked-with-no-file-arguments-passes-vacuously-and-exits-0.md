---
name: a-gate-invoked-with-no-file-arguments-passes-vacuously-and-exits-0
description: A gate invoked with no file arguments passes vacuously and exits 0
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-24-session-b714c7/txt/handoff.md
---

`peaks-gate staged` with zero in-scope files prints `EMPTY CHANGE SET (staged) — 0 in-scope files, NOTHING WAS
CHECKED.` and **returns 0** (`.husky/peaks-gate.mjs:211-217`, `reportEmpty`). "Zero files checked" is not "clean";
the gate says so itself in the same breath as the passing exit code, because an empty change set is legal and must
not become a failure.

The practical rule: when you verify with the repo's own gate, **assert the file count it reports**, never the exit
code alone. The same hole exists one level up — `inScope()` requires a path to *start with* `src/`, `tests/`,
`packages/` or `scripts/`, so a repo-root `vitest.config.ts` is filtered out of all three gate modes and covered by
no check at all (`rd/rid-muf2sasw-repair-3-handoff.md` §4, §6.1).
