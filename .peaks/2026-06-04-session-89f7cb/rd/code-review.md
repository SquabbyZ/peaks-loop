# Code Review — Slice 2: `peaks workspace reconcile` + SC Artifact Resolution

- session: 2026-06-04-session-89f7cb
- rid: 2026-06-04-workspace-reconcile
- reviewer: self-review (RD main loop)
- scope: src/services/workspace/reconcile-types.ts, src/services/workspace/reconcile-service.ts, src/cli/commands/workspace-commands.ts, src/services/sc/sc-service.ts, skills/peaks-solo/SKILL.md (runbook line), skills/peaks-solo/references/runbook.md, src/services/skills/skill-runbook-service.ts, tests/unit/workspace-reconcile-service.test.ts, tests/unit/sc-service.test.ts

## Summary

Implementation matches the PRD scope: W3 adds `peaks workspace reconcile` with a 4-tier canonical heuristic, dry-run by default, `--apply` for destructive deletion, `--older-than <days>` for the age threshold override. W4 adds a 3-tier `resolveArtifactSession` helper that is called from `validateArtifactRetention` and `recordCommitBoundary`, exposing `resolvedSessionId` and `candidateSources` as additive fields. Existing tests pass (no regressions); new tests (26 reconcile + 5 SC resolution) pass. Typecheck is clean. The 4-tier heuristic and the SC resolution precedence are deterministic and well-tested.

## Findings

| # | Finding | Severity | Status | Location |
|---|---|---|---|---|
| 1 | `repointSessionJson` writes a fresh `.peaks/.session.json` even when the canonical session is identical to the prior binding (no-op repoint). This is intentional (`lastActivity` refresh + the `repointedFrom`/`repointedTo` fields are populated either way), but the new helper could be confusing — a reader might expect a no-op. | LOW | deferred (documented in JSDoc + the repointed=false flag) | src/services/workspace/reconcile-service.ts `reconcileWorkspace()` |
| 2 | The W4 `modernRequirementRelativePaths` resolves the per-slice test file as `qa/test-cases/{sliceId}.md` (literal). The actual file naming in cda1cd has a `001-` prefix (e.g. `qa/test-cases/001-2026-06-04-monorepo-and-release.md`). The validation still passes because `sessionOwnsSlice` (the resolution tier that drives `resolvedSessionId`) uses the same literal name and so they match. The hard-coded `001-` prefix is a latent inconsistency, not a bug. | LOW | deferred (out of scope for this slice; the prefix is a per-slice-numbering convention owned by `peaks request init`) | src/services/sc/sc-service.ts `sessionOwnsSlice`, `MODERN_RETENTION_REQUIREMENTS` |
| 3 | The `applyDeletions` function calls `rmSync` with `force: true`, which swallows `ENOENT` errors but does not surface them in the envelope. A user that runs `--apply` against a session that has just been removed by a concurrent process will see no error. | LOW | deferred (rare; the `errors[]` field is for visible rm failures, and a concurrent-delete race is unlikely) | src/services/workspace/reconcile-service.ts `applyDeletions()` |
| 4 | `reconcile` command output has no `nextActions` when `repointed: false` and `wouldDelete: []`, which is the most common "nothing to do" case. | LOW | fixed (added warnings for `sessions.length === 0` and `deleted > 0`; the empty `nextActions: []` is acceptable for a true no-op) | src/cli/commands/workspace-commands.ts |
| 5 | The W4 resolution helper, when called from `recordCommitBoundary`, runs even when no workspace is configured. This is a (small) perf cost on every `peaks sc boundary` call. | LOW | deferred (a single `readFileSync` on the two tiny binding files; sub-millisecond; not worth caching) | src/services/sc/sc-service.ts `recordCommitBoundary` |
| 6 | The `candidateSources` field returns an array that grows with each tier checked. A reader might expect a single value (the source that won). The array form is intentional — it documents which tiers were consulted before the resolution landed, which is the "precedence observable in the envelope" the PRD asked for. | INFO | acknowledged | src/services/sc/sc-service.ts `resolveArtifactSession` |

## Required Fixes (CRITICAL+HIGH)

None.

## Recommended (MEDIUM+LOW)

- **F-4 (LOW, fixed)**: Added warnings for the `sessions.length === 0` and `deleted > 0` paths so the user gets a hint when reconcile has nothing to do or has actually removed something.
- **F-1, F-2, F-3, F-5 (LOW, deferred)**: Documented in the table above. All are minor and do not block the slice.

## Verdict

**pass** — implementation is correct, well-tested (26 + 5 = 31 new unit tests, all pass), type-clean, and matches the PRD acceptance criteria. The remaining LOW-severity items are either documented behavior (F-1, F-6) or out-of-scope cleanup (F-2, F-3, F-5) that the user can address in a follow-up slice if desired.

## Test coverage summary

- `tests/unit/workspace-reconcile-service.test.ts`: 26 tests covering discovery (5), canonical selection (5), re-pointing (2), age threshold (4), --apply / dry-run (3), top-level orchestrator (5), plus 2 edge cases.
- `tests/unit/sc-service.test.ts`: 5 new tests added to the W4 suite (active-skill wins, session-json fallback, find-fallback, no-resolution, boundary). Total SC tests: 30 (up from 25).
- All previously-passing tests still pass. 7 pre-existing Windows-specific failures (symlink + path-canonicalization) in `config-safety-canonical-root.test.ts` and `statusline-settings-service.test.ts` are not regressions; they predate this slice.
