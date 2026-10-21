---
name: the-gate-does-not-lint-tests-so-a-new-test-file-is-ungated
description: `pnpm lint` and the pre-commit gate lint only `src/` + `packages/` — eslint errors in a NEW test file are invisible to CI and only a hand-run lint finds them.
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-20-session-f7f45b/rd/requests/2026-10-21-race-batch-mode.md
---

`pnpm lint` and the gate lint an explicit file list from `scripts/lint/lint-file-list.mjs`:
**`src/` + `packages/`, 1344 files**. `tests/` and `scripts/` are the **shadow** — measured by the
census, recorded in the baseline, and **exempt** ("the boundary exempts it; nobody fixed it").

So a new **test** file can carry eslint errors that no gate and no CI run will ever see. On
2026-10-21 a sub-agent reported "eslint on all 7 src files → clean" and shipped six errors in a
test file it never linted: five `no-unnecessary-type-assertion` and one `no-floating-promises`. The
floating promise was the serious one — the test passed only because the command's action happened to
be synchronous, so the day it grows an `await` the assertions would read an empty envelope.

**How to lint a test file, since bare `npx eslint` finds no config and exits 2:**

```
node node_modules/eslint/bin/eslint.js --config config/eslint/.peaks-rules.cjs --no-ignore <files>
```

The config is a **dotfile** (`config/eslint/.peaks-rules.cjs`), so a plain `ls` does not show it.

**The rule for dispatch briefs: say "lint the TEST files too, not just the src files"** — the gate
will not catch them for you, and a clean src lint is no evidence about the tests. A sub-agent that
lints only what it wrote in `src/` has verified half of what it shipped.

The sibling trap is the same shape with a different trigger: see
[[the-gate-baseline-has-one-owner-the-orchestrator]] for the baseline half, and
[[a-new-src-file-over-300-lines-breaks-the-file-size-ratchet]] for the file-size half.
