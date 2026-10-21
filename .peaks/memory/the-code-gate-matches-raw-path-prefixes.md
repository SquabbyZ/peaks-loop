---
name: the-code-gate-matches-raw-path-prefixes
description: The PreToolUse code-gate once judged a path by its raw spelling (so `./src/x.ts` and absolute paths were ALLOWED) — fixed on 2026-10-21, with three residual spellings still open.
metadata:
  type: project
---

**State: FIXED (2026-10-21, slice `2026-10-21-code-gate-path-and-package-layout`, commit `eeb02060`).** This file records the defect and what is left; do not read it as "the gate is still broken".

**What it was.** `decideGateAction` (`src/services/hooks/pre-tool-code-gate.ts`) matched the hard-blocked
families with `matchesAny` = **`path.startsWith(family)`**, on the **raw** string `extractFilePath`
returned, with **no normalisation anywhere on the gate's path**. The families are project-relative
prefixes, so `src/x.ts` was denied while `./src/x.ts` and the absolute spelling of the same file were
**allowed** — the same edit refused in one spelling and permitted in another, and the permit is the one
that happens. The gate's own tests used **only** the relative form, so the other spellings were never
executed.

**What fixed it.** `normalizeGatePath(filePath, projectRoot)`: separators fold to `/`, a leading `./` is
dropped, and an absolute path **inside** the project root becomes project-relative before matching.
`decideGateAction` takes `projectRoot` as a **trailing optional** parameter, so every existing
three-argument call still works. The shell sibling folds the spelling-level forms only — it takes no
environment variable and no argument, so it has no project root, and a guess would be a false-positive
block; it still does **not** resolve a driver, because that would be a second implementation of a single
decision.

**What is STILL open** (measured by QA on 2026-10-21, all pre-existing — the same spellings were allowed
before the fix — and all recorded in the slice's QA artifacts):

| residual | pre-fix | post-fix | severity |
|---|---|---|---|
| `SRC/foo.ts` — a **case variant** of a family | allow | allow | LOW |
| `docs/../src/foo.ts` — an unresolved `..` in a relative path | allow | allow | LOW |
| the shell sibling vs the Node command on an absolute hard-blocked path | shell allow / node allow | shell allow / node **deny** | MEDIUM |
| a project **nested inside a git repo** — the absolute spelling is judged against the git root | allow | allow (the relative spelling is still denied) | MEDIUM |

⇒ **The spelling-independence invariant holds only when the project root IS the git root.** The case
variant and the unresolved `..` are the same class as the original defect: on a case-insensitive
filesystem `SRC/foo.ts` **is** `src/foo.ts`, and `docs/../src/foo.ts` resolves to `src/foo.ts`. Both are
rated LOW because the gate is a guardrail against an *accidental* direct edit, not a boundary against an
adversary — but they are bypasses of the same rule. Folding case and resolving `..` are the obvious
follow-up; the `..` case needs a decision on the base directory (a relative path is relative to the tool
call's own working directory, which the gate does not know).

**One thing that is not a bug, and looks like one:** an absolute path ending in `.md` inside a
hard-blocked family is allow-listed, before and after. The allow-list has a `.md` suffix rule, and
markdown files are deliberately always editable.

**The gate fails OPEN on a payload it cannot read** — deliberately, and that must not change (a blocked
edit on every call would be worse than an allowed one). But it now leaves a distinct marker on stderr,
`PEAKS_CODE_GATE_UNDECIDABLE`, because a silent allow hides the expensive failure: an acceptance that
feeds the payload through a pipe (which some shells do not forward to the process at all) then "passes"
every case while proving nothing. See
[[feed-the-code-gate-payload-by-file-redirection]] and [[the-gate-does-not-lint-tests]].
