---
name: session-dir-canonical-resolver-must-route-all-writes
description: All per-slice artifact writes must go through getSessionDir() — back-compat reads stay on legacy path
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-06-06-session-5b1095/txt/handoff-2026-06-07-session-runtime-dir-regression.md
---

As of slice `005-session-runtime-dir-regression` (2026-06-07), the canonical per-session workspace lives at `<root>/.peaks/_runtime/<sid>/` (NOT the legacy `<root>/.peaks/<sid>/`). All **write** paths in `src/` MUST route through the `getSessionDir(root, sid)` resolver at `src/services/session/getSessionDir.ts`. The legacy top-level path is preserved as a back-compat **read** fallback only (see `src/services/artifacts/request-artifact-service.ts:662`, `src/services/artifacts/artifact-prerequisites.ts:260`, `src/services/sc/sc-service.ts:289-291`).

The invariant is enforced at test-time by the static scan in `tests/unit/services/session/session-dir-canonical.test.ts`. Any new source file that joins `.peaks` + `sessionId` outside the resolver (and outside the explicit back-compat read allow-list) will fail the suite. If a new legitimate back-compat read is needed, add the file to `ALLOWED_LEGACY_READ_PATHS` with a justification comment, otherwise route the write through `getSessionDir`.

**Why:** The 4 suspect writers (`workflow-commands.ts:71`, `project-context-service.ts:100`, `project-memory-service.ts:404,409,410`, `perf-baseline-service.ts:151`) regressed from slice `2026-06-05-peaks-runtime-layer`'s canonicalization. The bug was a path-literal residue, not an architectural problem — but it produced user-visible artifacts (`.peaks/2026-06-06-session-5b1095/qa/performance-findings.md` and `.peaks/2026-06-06-session-5b1095/rd/tech-doc.md`) that bypassed the canonical home. The static-scan test makes this class of regression impossible to ship silently.

**How to apply:** Before writing any new code path that builds a per-slice artifact path, import `getSessionDir` from `src/services/session/index.ts` and call it with the project root + session id. The 6 canonical writers that already do this (`session-manager.ts:278,532`, `request-artifact-service.ts:391,404,436,661`, `artifact-prerequisites.ts:257`) are the reference pattern. Sub-agent dispatch uses a separate sub-tree (`.peaks/_sub_agents/<sid>/`); that's a different layout, not the per-session workspace.
