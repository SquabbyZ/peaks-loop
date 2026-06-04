# Code Review: buildArtifactRelativePath projectRoot refactor

- session: 2026-06-04-session-b60252
- rid: 001-2026-06-04-buildartifactrelativepath-projectroot
- type: refactor
- reviewer: code-reviewer (peaks-rd fan-out, parallel slot)
- reviewed files: `src/shared/change-id.ts`, `src/services/workflow/autonomous-resume-writer.ts`, `tests/unit/change-id.test.ts`
- verification: `pnpm typecheck` (pass, 0 errors), `pnpm vitest run tests/unit/change-id.test.ts` (46/46 pass, 484ms)

## Summary

The slice adds a new `buildArtifactRelativePathInRoot(projectRoot, changeId, ...segments)` sibling to the existing `buildArtifactRelativePath`, refactors the legacy function into a 1-line delegating wrapper, and updates the 6 call sites in `autonomous-resume-writer.ts` to pass the caller-owned `artifactWorkspacePath` as the explicit root. The delegation refactor preserves byte-for-byte behavior for the legacy wrapper (verified by re-walking the call: the legacy wrapper passes `findProjectRoot(process.cwd()) ?? process.cwd()` as the first arg, which always passes the non-empty check inside the new function, so the resolved root is identical to the pre-refactor value). All 6 caller updates are consistent — every call site uses `buildArtifactRelativePathInRoot(artifactWorkspacePath, changeId, ...)` with the same first argument. The 5 new test cases cover the documented contract (caller-passed projectRoot) rather than implementation branches: they assert that `getSessionId` is called with the explicit root, that two different roots produce different result shapes, and that the defensive empty-string fallback degrades to legacy behavior. `pnpm typecheck` and the targeted vitest run both pass clean.

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM
None.

### LOW

- **L-1 (tech-doc.md AD-1, AD-3 — documentation drift on call-site counts)**
  The tech-doc says "16 call sites across 3 services" (AD-1) and "10 call sites in `tech-service.ts` (2) and `workflow-autonomous-service.ts` (8)" (AD-3). Actual `grep -c "buildArtifactRelativePath("` shows: `tech-service.ts:7`, `rd-service.ts:12`, `workflow-autonomous-service.ts:8`, `autonomous-resume-writer.ts:0` (the 6 sites are now on the new function). Total remaining legacy call sites = 27, not 10. AD-1 also fails to mention `rd-service.ts` as a fourth service. This is a doc accuracy issue, not a code issue — the slice is correct and the AD-3 decision to scope only to `autonomous-resume-writer.ts` is still defensible (the new caller surface is the only one with a `projectRoot` in scope at the call site). Fix the count in the next pass.
  File: `.peaks/2026-06-04-session-b60252/rd/tech-doc.md:15, :36`

- **L-2 (src/shared/change-id.ts:84 — JSDoc claims absolute path is required, no runtime check)**
  The JSDoc for `buildArtifactRelativePathInRoot` says `@param projectRoot - ... Must be an absolute path.` The function does not validate absoluteness. A relative `projectRoot` would be accepted and used as-is for both `getSessionId(resolvedProjectRoot)` and `join(resolvedProjectRoot, '.peaks', sessionId, role)`. That is consistent with the legacy function (which also did not validate the result of `findProjectRoot`), and it does not introduce a regression. But the JSDoc promise is unbacked. Either tighten the contract (drop "must be an absolute path" from the JSDoc and document "any non-empty string is treated as a project root") or add a one-liner guard. Stylistic; no functional impact.
  File: `src/shared/change-id.ts:84-86`

- **L-3 (src/shared/change-id.ts:98 — redundant boolean)**
  `projectRoot && projectRoot.length > 0` is equivalent to `projectRoot !== ''` (or just `projectRoot`) for a typed `string` parameter. Not a bug; just noise. The defensive case the comment cites is `''`, so `projectRoot !== ''` is the most honest expression of intent.
  File: `src/shared/change-id.ts:98-100`

- **L-4 (src/shared/change-id.ts:98-100, :150 — minor DRY duplication)**
  The expression `findProjectRoot(process.cwd()) ?? process.cwd()` appears twice (once in the empty-string fallback inside `buildArtifactRelativePathInRoot`, once in the legacy `buildArtifactRelativePath` wrapper). Extracting a tiny `resolveLegacyProjectRoot()` helper would centralize the heuristic, but the cost of a helper for a 1-line expression is debatable. Low priority.
  Files: `src/shared/change-id.ts:100`, `src/shared/change-id.ts:150`

- **L-5 (tests/unit/change-id.test.ts:142-191 — minor coverage gap on the new function)**
  The 5 new tests cover: (1) no-session branch with explicit root, (2) with-session branch with explicit root, (3) two-roots-pollution-defense, (4) empty-string fallback, (5) early-throw on invalid changeId. Missing direct coverage: the `segments.length === 0` branch and the `segments[0] === ''` branch of the new function. Both branches are reachable when the legacy wrapper is called with no segments, and they are exercised by the existing 13 tests in the `buildArtifactRelativePath` describe blocks (since the legacy wrapper now delegates into the new function). Indirect coverage is acceptable; direct coverage would make the new function's contract more self-contained. Optional.
  File: `tests/unit/change-id.test.ts:142-191`

## Required Fixes

None. (No CRITICAL or HIGH findings.)

## Recommended

- **L-1**: Update `tech-doc.md` AD-1 and AD-3 with the actual counts (tech-service.ts:7, workflow-autonomous-service.ts:8, rd-service.ts:12, autonomous-resume-writer.ts:0; total 27 remaining legacy sites) so the next reader does not get confused about the scope. No code change required; this is a doc-only follow-up.
- **L-2**: Either drop "Must be an absolute path" from the JSDoc or add a runtime absoluteness check. Drop the claim is the lower-risk option (matches legacy behavior).
- **L-3**: Simplify to `projectRoot !== ''`.
- **L-5** (optional): Add 1-2 tests covering `buildArtifactRelativePathInRoot(root, changeId)` with no segments, and with `segments[0] === ''`, to make the new function's contract self-contained.

## Verdict

**verdict: pass**
