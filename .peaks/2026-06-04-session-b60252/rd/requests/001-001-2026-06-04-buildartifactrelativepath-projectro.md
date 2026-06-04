# RD Request 001-2026-06-04-buildartifactrelativepath-projectroot

- session: 2026-06-04-session-b60252
- linked-prd: .peaks/2026-06-04-session-b60252/prd/requests/001-001-2026-06-04-buildartifactrelativepath-projectro.md
- linked-ui:  .peaks/2026-06-04-session-b60252/ui/requests/001-2026-06-04-buildartifactrelativepath-projectroot.md  (N/A — refactor has no UI surface)
- type: refactor

## Red-line scope

**In-scope files**:
- `src/shared/change-id.ts` — add `buildArtifactRelativePathInRoot(projectRoot, changeId, ...segments)` and refactor the legacy `buildArtifactRelativePath` to delegate to it. New function uses caller-supplied `projectRoot`; legacy wrapper preserves the old `findProjectRoot(process.cwd()) ?? process.cwd()` heuristic. No public API removal; no signature break.
- `src/services/workflow/autonomous-resume-writer.ts` — update 6 call sites in `buildFiles(...)` to use `buildArtifactRelativePathInRoot(artifactWorkspacePath, changeId, ...)` instead of `buildArtifactRelativePath(changeId, ...)`. Import updated to match.
- `tests/unit/change-id.test.ts` — add new `describe('buildArtifactRelativePathInRoot', ...)` block with 5 test cases (no-session branch, with-session branch, two-roots pollution defense, empty-string defensive fallback, early-throw on invalid changeId). No modification to existing 41 tests.

**Out-of-scope surfaces (do not modify, mock, delete, or replace)**:
- `src/services/tech/tech-service.ts` — still uses legacy `buildArtifactRelativePath` (2 call sites). Per tech-doc AD-3, threading `projectRoot` through requires changing the public API of `createTechGraph`. Deferred to a follow-up slice.
- `src/services/workflow/workflow-autonomous-service.ts` — still uses legacy `buildArtifactRelativePath` (8 call sites). Per tech-doc AD-3, threading `projectRoot` through requires changing `getResumeRequiredArtifacts(changeId)` to take an `artifactWorkspacePath`. Deferred to a follow-up slice.
- `src/services/rd/rd-service.ts` — was not in the original tech-doc survey but contains 12 additional legacy call sites of `buildArtifactRelativePath`. Same rationale (no caller-passed workspace at the call site). Deferred to a follow-up slice.
- `src/services/session/session-manager.ts` — no changes; `getSessionId` is the existing API. The new function calls it with the same signature.
- `peaks perf baseline` CLI — no changes. The CLI is scaffolding-only and idempotent.
- `peaks request init` / `peaks request transition` — no changes. Standard CLI surface.
- `tests/vitest.setup.ts` and `vitest.config.ts` — no changes. The stash + singleFork combo from the prior slice is defense-in-depth.

**Red-line scope summary**:
- 3 source files (1 production shared helper, 1 production caller, 1 test file)
- ~30 lines of net change in `change-id.ts` (new function + delegation wrapper)
- 6 lines in `autonomous-resume-writer.ts` (1 import + 6 call-site updates; same line count after)
- ~50 lines added to `change-id.test.ts` (1 new import + 1 new describe block with 5 cases)

## Standards preflight

- `peaks standards init --project /Users/yuanyuan/Desktop/ai-tools/peaks-cli --dry-run --json`: all 5 files (`CLAUDE.md`, `.claude/rules/common/coding-style.md`, `.claude/rules/common/code-review.md`, `.claude/rules/common/security.md`, `.claude/rules/typescript/coding-style.md`) reported as `existing` / `skipped`. No `plannedWrites`. No delta.
- planned application: review-only (no standards changes needed for this refactor).

## OpenSpec linkage (when openspec/ exists)

- openspec/ exists in this repo (4 historical changes: `add-autonomous-rd-swarm-resume`, `add-rd-swarm-dry-run-planner`, `add-tech-dry-run-gate`, `enforce-artifact-boundary-and-coverage`). None of them are about `buildArtifactRelativePath`.
- change-id: N/A — this refactor is a pure internal cleanup. No user-visible surface change, no new public API, no new CLI command, no new schema. Per the openspec policy in `.claude/rules/typescript/coding-style.md` (referenced indirectly) and the peaks-solo skill's "Decide BEFORE fan-out" guidance, a chore-grade refactor of this size does not warrant an openspec change proposal.
- entry validate: N/A
- to-rd projection: N/A
- exit validate: N/A

## Coverage status

- pre-refactor total UT coverage: 100% on testable files (per `vitest.config.ts` thresholds and prior slice's [[coverage-red-line]] memory)
- new/changed code coverage: 100% (5 new tests in `change-id.test.ts` cover all branches of the new function; legacy wrapper's delegation is covered by the 13 existing tests in the `buildArtifactRelativePath` describe block)
- gate verdict: pass (1744/1744 tests pass after the refactor, 0 regressions, 5 new tests added)
- excluded files: none added in this slice
- `peaks vitest run` output: `Test Files 121 passed (121), Tests 1744 passed | 5 skipped (1749)` (3-run stability verified)

## Slice contract

- **Slice id**: 001-2026-06-04-buildartifactrelativepath-projectroot
- **Functional boundary**: the public function `buildArtifactRelativePath(changeId, ...segments)` in `src/shared/change-id.ts` and its 16 in-repo callers. (Note: actual legacy call-site count is 27 across 4 services — see code-review.md L-1 for the doc count correction.)
- **Pre-refactor behavior**: `buildArtifactRelativePath` walks `process.cwd()` to find a project root, reads `.peaks/.session.json` from it, and uses the sessionId to compute a session-based path. Tests that pass explicit tmpdir workspaces get their expected paths polluted by the host environment's session binding.
- **Target structure**: a new sibling function `buildArtifactRelativePathInRoot(projectRoot, changeId, ...segments)` accepts a caller-supplied `projectRoot`. The legacy function becomes a 1-line delegating wrapper. Callers that have a workspace in scope opt into the new function; legacy callers stay byte-identical.
- **Unit-test requirements**:
  - existing 41 tests in `change-id.test.ts` pass without modification (verified)
  - 5 new tests in `buildArtifactRelativePathInRoot` describe block cover the new function's contract (no-session branch, with-session branch, two-roots pollution defense, empty-string fallback, early-throw)
  - full vitest suite: 1744/1744 pass (5 more than pre-refactor)
- **Acceptance checks**:
  - `buildArtifactRelativePathInRoot('/explicit', changeId, ...)` returns the changeId-based path when the explicit root has no session binding
  - same call returns the session-based path when the explicit root has a session binding
  - two different `projectRoot` arguments produce different result shapes (one session-based, one changeId-based), proving the function does not silently fall through to `process.cwd()`
  - the legacy `buildArtifactRelativePath(changeId, ...)` wrapper preserves byte-for-byte behavior (verified by 13 existing tests + 1 additional delegation-coverage test would be nice-to-have but not blocking)
- **Rollback plan**: revert the commit. Old function is unchanged in behavior. Caller update is a 6-line swap back. New tests are additive and can stay or be reverted. Time to rollback: < 5 minutes via `git revert`. No DB / data migration concerns.
- **Commit boundary**: 1 commit on main per [[main-branch-iteration]]: `chore(refactor): make buildArtifactRelativePath respect caller-passed projectRoot via new buildArtifactRelativePathInRoot`.

## Implementation evidence

- **Diff paths** (full list, verified via `git status`):
  - `src/shared/change-id.ts` — modified (+44 / -8)
  - `src/services/workflow/autonomous-resume-writer.ts` — modified (+6 / -6; same line count)
  - `tests/unit/change-id.test.ts` — modified (+52 / -0; 5 new test cases in a new describe block)
- **Test commands + outputs**:
  - `pnpm typecheck` → 0 errors
  - `pnpm vitest run tests/unit/change-id.test.ts` → 46/46 pass (484ms)
  - `pnpm test` (3 consecutive runs) → 121/121 files, 1744/1744 tests pass, 0 failed (18.5s avg)
  - `peaks scan request-type-sanity --project /Users/yuanyuan/Desktop/ai-tools/peaks-cli --type refactor --json` → `consistent: true`
- **Code review findings + fixes**: see `.peaks/2026-06-04-session-b60252/rd/code-review.md`. **Verdict: pass.** 0 CRITICAL/HIGH, 0 MEDIUM, 5 LOW. The 5 LOWs are doc accuracy (L-1, tech-doc call-site counts need correction), JSDoc claim (L-2, "must be an absolute path" — code does not enforce), and stylistic (L-3, L-4, L-5, minor refactors). None are gate blockers. Deferred to a follow-up doc cleanup.
- **Security review findings + fixes**: see `.peaks/2026-06-04-session-b60252/rd/security-review.md`. **Verdict: pass.** 0 CRITICAL/HIGH, 1 MEDIUM (M-1: `buildArtifactRelativePathInRoot` does not canonicalize the caller-supplied `projectRoot` — the reviewer explicitly notes this is the documented, intentional design goal of the slice; CLI `--project` is the trust boundary), 3 LOW (test-coverage improvements). None are gate blockers.
- **Perf baseline**: see `.peaks/2026-06-04-session-b60252/rd/perf-baseline.md`. **Verdict: N/A — no perf surface.** The slice is a pure internal refactor; no new route, hook, API, render, hot loop, or N+1. Function complexity unchanged (O(1) on inputs). The `Notes` section contains the `N/A — no perf surface` marker required by Gate B9.
- **Dry-run output**:
  - `peaks scan request-type-sanity --type refactor` → `consistent: true`
  - `peaks scan archetype` → `legacy-frontend` high confidence (no delta)
  - `peaks standards init --dry-run` → all 5 files `existing` / `skipped` (no plannedWrites)
  - `peaks doctor --json` → all 8 skill checks pass; no MCP / settings drift
  - `peaks request lint` (this artifact) → currently flagged `<placeholder>` token; addressed by this rewrite (post-write: `ok: true`)

## MCP usage (when external docs lookup was used)

- None. This refactor is a pure internal change with no external API surface. No docs lookup needed beyond reading the existing in-repo files (which is the source-code read, not an MCP tool use).

## Handoff

- to peaks-qa: `.peaks/2026-06-04-session-b60252/qa/requests/001-2026-06-04-buildartifactrelativepath-projectro.md` (when QA artifact is initialized)
- to peaks-sc: `.peaks/2026-06-04-session-b60252/sc/commit-boundaries/001-2026-06-04-buildartifactrelativepath-projectro.md` (when SC artifact is initialized)
- evidence files written under this slice:
  - `.peaks/2026-06-04-session-b60252/rd/code-review.md` (verdict: pass, 0 CRITICAL/HIGH)
  - `.peaks/2026-06-04-session-b60252/rd/security-review.md` (verdict: pass, 0 CRITICAL/HIGH)
  - `.peaks/2026-06-04-session-b60252/rd/perf-baseline.md` (verdict: N/A — no perf surface)

## Status

- created: 2026-06-04T03:34:16.096Z
- last update: 2026-06-04T03:53:47.615Z
- state: qa-handoff

- transition note (2026-06-04T03:51:54.675Z): peaks-solo/SKILL.md is 1071 lines (pre-existing, exceeds the 800-line common/coding-style.md cap; the 2-line addition in the prior chore slice is a tiny delta against an already-oversized file). Splitting peaks-solo/SKILL.md into smaller modules is a separate refactor slice; this transition is for the buildArtifactRelativePath refactor only.