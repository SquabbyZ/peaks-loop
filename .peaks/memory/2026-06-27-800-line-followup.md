---
name: 2026-06-27-800-line-followup
description: 3 service files over the Karpathy 800-line cap, identified during the post-mortem of slice 2026-06-27-archive-feature-removal. Recorded 2026-06-27 for治理 in a future slice; user-pinned as "明天再说" (deferred).
metadata:
  type: project
  sourceArtifact: src/services/doctor/doctor-service.ts
  sourceArtifactSecondary: src/services/memory/project-memory-service.ts
  sourceArtifactTertiary: src/services/config/config-service.ts
  createdAt: 2026-06-27
---

## 800-line Karpathy cap violations — follow-up tracking

Slice `2026-06-27-archive-feature-removal` (peaks-rd inline, 2026-06-27) initially reported M-1 as "`workspace-commands.ts` is still over 800 LOC" — that finding was based on a stale file-header doc comment and was **incorrect**. The file is 56 LOC.

However, the LOC scan that was triggered by the correction **did find 3 real violations**:

| File | LOC | Over by | Likely split points (educated guess) |
|---|---|---|---|
| `src/services/doctor/doctor-service.ts` | 1067 | +267 | `checks/` (per-check module) + `report/` (rendering) + `plugin-registry/` (extensibility) |
| `src/services/memory/project-memory-service.ts` | 1032 | +232 | `parsers/` (per-kind) + `store/` (filesystem layout) + `index/` (search/ranking) |
| `src/services/config/config-service.ts` | 911 | +111 | `resolve/` (project-root canonicalization) + `load/` (file IO + parse) + `validate/` (schema) |

### Why this matters

- Karpathy guideline #2 = "800-line file cap". Three services violate it.
- Each violation makes the file harder to navigate, harder to test in isolation, and more likely to hide unrelated responsibilities that belong in separate modules.
- The 1067-LOC `doctor-service.ts` is the worst offender and most likely to grow further (it's the canonical health-check surface; new checks get added over time).

### Why deferred

- Context budget for 2026-06-27 already spent: 5+ slices, archive-removal completion + post-mortem.
- Each split is itself a non-trivial slice (1067 → 3 files = ~350 LOC each; needs TDD + code review + QA per slice).
- 3 splits × ~30-50 min/slice = 1.5-2.5 hours of focused work. Better as a dedicated session.
- Per user direction (2026-06-27, peaks-code AskUserQuestion): "先记录，明天再说".

### Recommended approach (when picked up)

1. **Start with `config-service.ts` (911 LOC)** — smallest of the three, lowest risk, smallest blast radius. Use it as the template for the other two splits.
2. **Then `project-memory-service.ts` (1032 LOC)** — middle complexity; likely has natural seam between per-kind parsers and the index.
3. **Then `doctor-service.ts` (1067 LOC)** — most complex; consider whether the per-check registration is better expressed as data (a config-driven registry) than as code (an if-chain of imports).

For each:
- TDD micro-cycle: write tests for the new module first, then extract.
- Re-export from the original path for back-compat, then deprecate over a release.
- Each split is its own slice; do NOT bundle all three into one slice.

### Related

- Slice `2026-06-27-archive-feature-removal` (this handoff's parent)
- `.peaks/_runtime/2026-06-26-session-9cd203/rd/2026-06-27-archive-feature-removal-code-review.md` — Correction section
- `.peaks/_runtime/2026-06-26-session-9cd203/txt/handoff-2026-06-27-archive-feature-removal.md` — open-questions section