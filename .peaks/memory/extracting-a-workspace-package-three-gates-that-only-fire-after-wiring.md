---
name: extracting-a-workspace-package-three-gates-that-only-fire-after-wiring
description: Extracting a workspace package — three gates that only fire after wiring
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-11-05-session-af31e4/txt/handoff.md
---

When adding a package under `packages/`, three separate gates bite only after the package is
wired in, and each has a different fix. (1) `tests/unit/scripts/packages-build-prerequisite.test.ts`
has two independent arms: `git ls-files` must see the package (stage it — `dist/` is gitignored so
`git add -A packages/<pkg>` is safe) and `node_modules` must resolve it (add it to the ROOT
`package.json` as `workspace:*` and run `pnpm install`). (2) The package's own tests are NOT in the
root `pnpm test:unit` — CI runs them via `pnpm -r --filter "./packages/*" run test`, so "unit suite
green" says nothing about them. (3) `packages/.dist-stamps.json` staleness makes the root suite's
global setup refuse to start; `pnpm -r --filter "./packages/*" run build` plus
`node scripts/write-package-dist-stamps.mjs` clears it.
