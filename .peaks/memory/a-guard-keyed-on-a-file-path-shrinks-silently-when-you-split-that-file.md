---
name: a-guard-keyed-on-a-file-path-shrinks-silently-when-you-split-that-file
description: A guard keyed on a file path shrinks silently when you split that file
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-29-session-b7cf21/txt/handoff.md
---

Three independent guards in this repo decide what to measure by PATH, so moving code into a
sibling removes it from coverage without any signal: the swallow census asserts zero
swallowing frames for three named files (line-insensitive, path-keyed); `coverage-c8.mjs`
excludes by path, and counting one new sibling would have added 151 statements (100 uncovered)
to a `--100` gate; `no-runtime-input-guard` keeps a `MEASURED_ESCAPE_MODULES` list of modules
allowed to join runtime paths. None of this is visible to `tsc`, and a split looks green.

Before hoisting a symbol, grep for it being READ BY TEXT from another module (a real case:
`promotion-artifact-evidence` regex-reads `HardFloorCategory` out of `mode-gate.ts` and a unit
test runs that read against the repo file - hoisting it makes a different module parse nothing).
After the split, grep the original path through every path-keyed list and re-declare it for the
sibling, or state that it does not apply. Two greps: symbol before, path after.
