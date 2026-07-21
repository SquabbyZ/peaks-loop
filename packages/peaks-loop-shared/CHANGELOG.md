# peaks-loop-shared

## 0.0.4

### Patch Changes

- Registry-repair: confirm the package tarball ships a clean
  `package.json` with internal deps pinned to `0.0.4` (no
  `workspace:*` leak) and a working `bin/peaks.js` entry. Pre-2.0
  registry install (`npm i -g peaks-loop`) now succeeds end-to-end.

## 0.0.5

### Patch Changes

- workflow-guard fixture changeset (positive control)

## 0.0.5

### Patch Changes

- workflow-guard fixture changeset (positive control)

## 0.1.0

### Minor Changes

- 5d01343: Monorepo extraction: peaks-loop 4.0.0-beta.15 ships the new pnpm
  workspace shell with 6 independent packages extracted from the main
  repo as Tier-A zero/low-coupling domains:

  - peaks-loop-shared (4 utils: fs / paths / result / version)
  - peaks-loop-mut (mutation testing + ECC cache)
  - peaks-loop-doctor (project health check)
  - peaks-loop-crystallization (crystallization pipeline)
  - peaks-loop-final-review (4-dim business review)
  - peaks-loop-audit-independent (security + perf audit)

  Each subpackage has its own typecheck / build / vitest pipeline; they
  are wired back into the main peaks-loop CLI via workspace:_ protocol.
  Trusted Publishing (OIDC) is wired via .github/workflows/publish.yml
  on push tags v_._._ — no NPM_TOKEN required.

  Also:

  - D21: peaks sub-agent finalize command (LLM-side completion signal
    to mark dispatch records done/failed/cancelled; without it records
    would stay queued forever).
  - Trusted Publishing via OIDC — npmjs.com trusted publisher
    configured; npm token removed from ~/.npmrc.
