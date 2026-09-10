---
name: a-diff-scoped-gate-reporting-zero-violations-may-have-checked-nothing
description: A diff-scoped gate reporting zero violations may have checked nothing
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-10-session-528a63/txt/handoff-defect-sweep.md
---

`peaks scan file-size` reports `checkedFiles` alongside `violations`, and it is **diff-scoped**
(`--base-ref`, default `HEAD`). Run on a clean tree it returns `violations: []` and `checkedFiles: 0`
— which reads exactly like "clean" and means "nothing was examined". The same command had also flagged
`.peaks/memory/index.json` (2657 lines, regenerated) on every commit that reindexed memory, which is
how the ambiguity was noticed.

The scan also had **zero test coverage** before this round, which is why the false positive shipped and
survived.

**Why:** a gate whose "pass" and "did not run" are the same output cannot be trusted either way, and the
diff-scoping makes the pass case the common one — you see it precisely when you changed little.

**How to apply:** read the count, not just the verdict — treat "0 checked" as "not run", never as
"clean". When a gate flags a generated file, exempt **generated artifacts declaratively in one place**
(lockfiles, derived indexes) rather than raising the threshold or exempting source directories, and
prove the exemption did not widen by showing a real oversized source file is still caught.
