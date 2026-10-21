---
name: the-published-package-only-boots-with-nested-subpackages
description: The published peaks-loop only starts when the four sub-packages sit NESTED under the root package (npm's global layout) — a local `npm i peaks-loop` hoists them and the CLI dies at startup.
metadata:
  type: project
---

`peaks-loop-shared` publishes **`dist/**` only** — no `skills/`. Its `dist/paths.js` resolves the
"Peaks repository root" by walking up looking for a directory that has **both** `package.json` and
`skills/` (`findRepoRoot`, `src/shared/path-utils.ts` sibling module `packages/peaks-loop-shared/src/paths.ts`).

⇒ The lookup only lands when the walk reaches the **root** package's directory, which is the one that
ships `skills/**`. That happens **iff the four sub-packages are nested under the root**:

```
node_modules/peaks-loop/                      <- package.json + skills/   <- findRepoRoot lands HERE
node_modules/peaks-loop/node_modules/peaks-loop-shared/   <- and the walk passes through here
```

**npm's global install produces exactly that** (verified: the working global 4.1.12 has
`node_modules/peaks-loop/node_modules/peaks-loop-{shared,shared-channel,mut,internal-runtime}/`
and nothing peaks-* at the global top level). **A local install does not**: npm hoists the
sub-packages to `node_modules/` beside the root, the walk never passes through the root, and the CLI
dies on the first import with:

```
Error: Unable to locate Peaks repository root from .../node_modules/peaks-loop-shared/dist
```

**The README only documents the global install** (`npm i -g peaks-loop`), so the broken case is the
undocumented one. Measured 2026-10-21 while preparing 4.1.13: a local install of the packed
tarballs produces this failure on `peaks --version`.

**How to apply:** when testing the published artifact in a consumer project, reproduce the
**global** layout — install with `npm i -g --prefix <temp>` (a temp prefix keeps the user's real
global install untouched) and, if the sub-packages were hoisted, move them under
`node_modules/peaks-loop/node_modules/`. Two related traps in the same exercise: npm 11 gates
lifecycle scripts, so the install needs `--allow-scripts=peaks-loop` (the `postinstall` is what
creates the canonical store), and the install target is redirectable with `PEAKS_HOME`,
`PEAKS_CLAUDE_SKILLS_DIR`, `PEAKS_CLAUDE_OUTPUT_STYLES_DIR` and `PEAKS_CLAUDE_AGENTS_DIR`, which is
what keeps a test install off the user's real `~/.claude`.
