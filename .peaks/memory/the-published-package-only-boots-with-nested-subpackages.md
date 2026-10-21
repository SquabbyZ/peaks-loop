---
name: the-published-package-only-boots-with-nested-subpackages
description: The published peaks-loop only started when the sub-packages sat NESTED under the root (npm's global layout) — a local `npm i peaks-loop` hoisted them and the CLI died at startup. FIXED 2026-10-21.
metadata:
  type: project
---

**State: FIXED (2026-10-21, slice `2026-10-21-code-gate-path-and-package-layout`, commit `386ff9d9`).** This file records the defect and the traps around it; do not read it as "the package is still broken".

**What it was.** `peaks-loop-shared` publishes **`dist/**` only** — no `skills/`. Its
`packages/peaks-loop-shared/src/paths.ts` resolved the skills root with `findRepoRoot`, walking up for
a directory holding **both** a `package.json` and a `skills/`. That walk can only land on the **root**
package, and it reaches the root only if the walk passes through it — which happens only when the
sub-packages sit **nested** under it.

- **npm's global install nests** ⇒ `npm i -g peaks-loop` works (this is why 4.1.12 and 4.1.13 worked)
- **a local install hoists** the sub-packages beside the root ⇒ the walk never passes through the root
  ⇒ the published CLI died on its first import:

```
Error: Unable to locate Peaks repository root from .../node_modules/peaks-loop-shared/dist
```

⇒ **The install path that was documented worked; the one that was not documented was broken.** The README
only documents `npm i -g peaks-loop`.

**What fixed it.** `packages/peaks-loop-shared/src/paths-resolve.ts` asks, at every level of the walk,
whether the root package is **beside** this directory — which covers the nested layout, the hoisted
layout and a pnpm store alike — and falls back to the canonical asset store (`PEAKS_HOME` or `~/.peaks`),
the skills' legal home, when the root package is not on disk at all. The shared package publishes only
`dist/**`, so it cannot import the root package's script; the environment variable's **name** is
therefore spelled out in both places, with the reason recorded at each.

**Traps around reproducing this** (both cost real time on 2026-10-21):

- **Install the tarballs into a directory OUTSIDE the repository.** A consumer directory *inside* the
  repo has the repo root as an ancestor holding `package.json` + `skills/`, which **masks the very thing
  under test** — the old lookup succeeds there and the defect does not reproduce.
- **Do not hand-move the sub-packages.** npm's own hoisting is the condition under test; moving them
  by hand recreates the nested layout and hides the bug.
- **Build before the unit suite.** The shared package's `src/` changed, so `packages/*/dist` is stale,
  and the suite's packages-build preflight then **refuses to start** — the output looks like a test
  failure, but **no test ran**.

**Verification that counts:** the five packed tarballs installed with `npm i` into a fresh directory,
npm's hoisting untouched ⇒ `peaks --version` starts and prints the version; and the **pre-fix** lookup
against that same installed path reproduces `Unable to locate Peaks repository root`.
