---
name: src-services-session-canonical-workspace-resolver
description: src/services/session/ owns the canonical per-session workspace resolver; getSessionDir() is the single entry point
metadata:
  type: module
  sourceArtifact: .peaks/_runtime/2026-06-06-session-5b1095/txt/handoff-2026-06-07-session-runtime-dir-regression.md
---

`src/services/session/` is the canonical home for the per-session workspace. The single public API for the workspace path is `getSessionDir(root, sid)` at `src/services/session/getSessionDir.ts`, re-exported from `src/services/session/index.ts`. The resolver is intentionally a 2-line join (`return join(projectRoot, '.peaks', '_runtime', sessionId)`) — no normalization, no config, no side effects. Any new code that needs a per-session artifact path MUST call this resolver.

**Adjacent files in this module:**

- `src/services/session/session-manager.ts` — session lifecycle (init, list, abandon, finish, getSessionId). Uses `getSessionDir` for any path it constructs.
- `src/services/session/getSessionDir.ts` — the resolver. Imported via the barrel, never reached for via a deep import.

**Risk surface:** High. A path-literal regression in this resolver (e.g. dropping `_runtime` from the join, or normalizing the root aggressively) would break every downstream write path. The `tests/unit/services/session/session-dir-canonical.test.ts` static scan guards against regressions in OTHER files, but a regression INSIDE the resolver itself would only be caught by TC-1 (resolver shape) and TC-2 (projectRoot shape). Both cases are covered by the existing 3 tests; no new test gap.

**Why:** Slice `005-session-runtime-dir-regression` (2026-06-07) introduced this resolver to consolidate 4 stragglers that were hard-coding `<root>/.peaks/_runtime/<sid>/`. The static-scan test makes future bypasses impossible to ship silently.

**How to apply:** When touching this module, keep the resolver a 2-line join. If a future need requires more logic (e.g. migration-aware path resolution), add a separate `getLegacySessionDir` for the dual-read case rather than overloading the resolver's behavior.
