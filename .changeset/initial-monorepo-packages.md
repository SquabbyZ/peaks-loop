---
"peaks-loop": 4.0.0-beta.15
"peaks-loop-shared": 0.0.1
"peaks-loop-mut": 0.0.1
"peaks-loop-doctor": 0.0.1
"peaks-loop-crystallization": 0.0.1
"peaks-loop-final-review": 0.0.1
"peaks-loop-audit-independent": 0.0.1
---

Monorepo extraction: peaks-loop 4.0.0-beta.15 ships the new pnpm
workspace shell with 6 independent packages extracted from the main
repo as Tier-A zero/low-coupling domains:

- peaks-loop-shared (4 utils: fs / paths / result / version)
- peaks-loop-mut (mutation testing + ECC cache)
- peaks-loop-doctor (project health check)
- peaks-loop-crystallization (crystallization pipeline)
- peaks-loop-final-review (4-dim business review)
- peaks-loop-audit-independent (security + perf audit)

Each subpackage has its own typecheck / build / vitest pipeline; they
are wired back into the main peaks-loop CLI via workspace:* protocol.
Trusted Publishing (OIDC) is wired via .github/workflows/publish.yml
on push tags v*.*.* — no NPM_TOKEN required.

Also:
- D21: peaks sub-agent finalize command (LLM-side completion signal
  to mark dispatch records done/failed/cancelled; without it records
  would stay queued forever).
- Trusted Publishing via OIDC — npmjs.com trusted publisher
  configured; npm token removed from ~/.npmrc.
