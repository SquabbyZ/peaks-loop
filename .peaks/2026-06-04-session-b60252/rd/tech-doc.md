# RD Tech-Doc: buildArtifactRelativePath projectRoot support

- session: 2026-06-04-session-b60252
- rid: 001-2026-06-04-buildartifactrelativepath-projectroot
- type: refactor
- linked-prd: .peaks/2026-06-04-session-b60252/prd/requests/001-001-2026-06-04-buildartifactrelativepath-projectro.md

## Architecture decisions

### AD-1: Add a new function `buildArtifactRelativePathInRoot` rather than change the existing signature

**Decision**: introduce `buildArtifactRelativePathInRoot(projectRoot: string, changeId: string, ...segments: string[])` as a sibling function to the existing `buildArtifactRelativePath`. Keep the existing function unchanged for back-compat.

**Why**:
- The existing function is called from 16 call sites across 3 services (`tech-service.ts:2`, `workflow-autonomous-service.ts:8`, `autonomous-resume-writer.ts:6`). A signature change at any of those would break the others or force a wide refactor.
- A new function isolates the change. Old callers stay byte-for-byte identical (no new `projectRoot` to thread through). New callers that have an explicit `projectRoot` in scope opt in.
- TypeScript overloads (adding a second-arg form to the existing function) were considered and rejected: variadic-typed overloads are awkward, and the "is the first rest arg a projectRoot or a segment" detection is fragile. A separate function is unambiguous.

**Tradeoffs**:
- Mild API surface growth: two functions instead of one. Mitigated by clear JSDoc and consistent naming.
- Future cleanup: when the next major version wants to make `projectRoot` required, this is a one-liner rename + signature flip. The split today makes that future change cleaner, not harder.

### AD-2: Use `getSessionId(projectRoot)` (NOT `getSessionIdCanonical`)

**Decision**: the new function calls `getSessionId(projectRoot)`, not `getSessionIdCanonical(projectRoot)`.

**Why**:
- The callers (`autonomous-resume-writer.ts`) construct `artifactWorkspacePath` from a CLI flag or test fixture, then call `join(artifactWorkspacePath, buildArtifactRelativePath(...))`. The `artifactWorkspacePath` is the project root we want for session lookup.
- `getSessionId` uses strict equality on the stored `projectRoot` form, which matches the documented contract of "this is a project root, treat it as such." `getSessionIdCanonical` is for `--project` flag reconciliation; not needed here.
- The test fixture creates the workspace via `mkdtempSync` and writes a `.peaks/config.json` marker; it does not write a `.peaks/.session.json`. So `getSessionId` returns null in tests → function falls into the changeId-based branch → tests assert the changeId path. This is the desired contract.

**Tradeoffs**: if a future test writes a real `.peaks/.session.json` in the test workspace, the new function would return session-based paths for that test. The test would need to opt out by stubbing `getSessionId` (or by `vi.mock`'ing the session-manager, matching the pattern in `change-id.test.ts:5`).

### AD-3: Caller update scope — only `autonomous-resume-writer.ts` for this slice

**Decision**: only update the 6 call sites in `src/services/workflow/autonomous-resume-writer.ts` to use the new function. The 10 call sites in `tech-service.ts` (2) and `workflow-autonomous-service.ts` (8) stay on the legacy function.

**Why**:
- `autonomous-resume-writer.ts` is the only caller that has a clear caller-passed workspace in scope (each call is `join(artifactWorkspacePath, buildArtifactRelativePath(...))` — the `artifactWorkspacePath` is the natural projectRoot).
- `tech-service.ts` callers (`architectureRoot(changeId)` and `waveManifestPath(changeId, ...)`) only have a `changeId`; threading a projectRoot through would require changing the public API of `createTechGraph`.
- `workflow-autonomous-service.ts:getResumeRequiredArtifacts(changeId)` similarly only has a `changeId`; threading requires changing 5+ call sites to also pass `request.artifactWorkspacePath`.
- Both of those wider refactors are real but out of scope for this dogfood slice. The PRD's acceptance criteria say "the 31 tests pass deterministically" — they do after this slice because the test fixtures go through `autonomous-resume-writer.ts` (and through `workflow-autonomous-service.ts` via `createAutonomousWorkflowPlan`, which gets the new behavior indirectly via the call chain).
- A follow-up `refactor` slice can address the other 10 call sites if the user wants belt-and-suspenders.

**Tradeoffs**: `tech-service.ts` and `workflow-autonomous-service.ts` are still susceptible to the bug if their tests ever run with a `.peaks/.session.json` in the real project root. The `tests/vitest.setup.ts` stash is defense-in-depth.

## Component changes

### `src/shared/change-id.ts`
- **Add** `buildArtifactRelativePathInRoot(projectRoot: string, changeId: string, ...segments: string[]): string`. Body is structurally identical to `buildArtifactRelativePath` except it uses the caller-passed `projectRoot` instead of `findProjectRoot(process.cwd())`. Falls back to `process.cwd()` only if `projectRoot` is the empty string (defensive; should not happen with the new API).
- **Refactor** `buildArtifactRelativePath` to delegate to `buildArtifactRelativePathInRoot` when the legacy `findProjectRoot(process.cwd())` resolves. This is a TINY refactor (5-7 lines) that reduces duplication. Alternative: leave `buildArtifactRelativePath` unchanged. Chose the delegation refactor to keep the path-construction logic in one place. The session lookup + dirPath computation + number / filename generation is now in one body.

### `src/services/workflow/autonomous-resume-writer.ts`
- **Update** all 6 call sites (lines 139, 143, 147, 151, 155, 159) to use `buildArtifactRelativePathInRoot(artifactWorkspacePath, changeId, ...segments)` instead of `buildArtifactRelativePath(changeId, ...segments)`.
- No other change to this file.

### `tests/unit/change-id.test.ts`
- **Add** a new `describe('buildArtifactRelativePathInRoot', ...)` block with 3-4 test cases:
  1. With an empty `projectRoot` string → throws or returns changeId path (decide which; per AD-1 default behavior: empty string falls back to `process.cwd()`).
  2. With a `projectRoot` that has no `.peaks/.session.json` → returns the changeId-based path (`.peaks/<changeId>/<segments>`).
  3. With a `projectRoot` that has a `.peaks/.session.json` (set up via tmpdir + `writeFileSync`) → returns the session-based path (`.peaks/<sessionId>/<role>/<number>-<changeId>.md`).
  4. With a different `projectRoot` and a different session binding → confirms two calls with different `projectRoot` produce different paths (one session-based, one changeId-based), exercising the new code path.
- The existing 13 tests in `buildArtifactRelativePath` describe block stay byte-for-byte unchanged (back-compat verified).
- The existing `with session` describe block at line 120 stays unchanged.

### `tests/vitest.setup.ts`
- **No change**. The stash + singleFork combo from the previous slice is defense-in-depth and stays.

### `vitest.config.ts`
- **No change**. The `setupFiles` + `singleFork` from the previous slice stays.

## Data flow

1. CLI / test fixture writes `.peaks/.session.json` in the project root (or doesn't, for tests).
2. Caller invokes `buildArtifactRelativePathInRoot(artifactWorkspacePath, changeId, ...segments)`.
3. Function calls `validateChangeIdOrThrow(changeId)` first (cheap).
4. Function calls `getSessionId(artifactWorkspacePath)` (no walk to `process.cwd()`).
5. If session exists AND segments[0] is a non-empty role: produce session-based path with `getNextNumber`.
6. Else: produce changeId-based fallback path.
7. Return normalized path string.

The data flow is the same as the old function, but with `artifactWorkspacePath` (caller-controlled) in place of `findProjectRoot(process.cwd())`.

## CSS/Style changes

N/A — backend / CLI refactor, no UI surface.

## API contract changes

- **New exported function** `buildArtifactRelativePathInRoot(projectRoot: string, changeId: string, ...segments: string[]): string` in `src/shared/change-id.ts`.
- **No change** to `buildArtifactRelativePath` signature.
- **No change** to any CLI surface.
- **No change** to schemas/.

## Dependencies

No new packages.

## Test plan

- `pnpm typecheck` — must pass.
- `pnpm test` — must pass (1739 + new tests in `change-id.test.ts`).
- `git diff --stat` — should show: `src/shared/change-id.ts` (modified), `src/services/workflow/autonomous-resume-writer.ts` (modified), `tests/unit/change-id.test.ts` (modified), `tests/vitest.setup.ts` (unchanged from prior slice), `vitest.config.ts` (unchanged from prior slice).
- Manual walk-through of the new test cases (3-4 new) confirms both branches (session path + changeId path) work.
- Defense-in-depth check: temporarily remove `tests/vitest.setup.ts` setupFiles entry, run `pnpm test` — should still pass. (Per PRD acceptance criteria: "even if `tests/vitest.setup.ts` is removed, the tests still pass".)

## Coverage plan

- The new function `buildArtifactRelativePathInRoot` is exercised by 3-4 new test cases. Expected: 100% line / branch / function / statement coverage (matches the project's [[coverage-red-line]] standard).
- `buildArtifactRelativePath` after the delegation refactor: the `findProjectRoot` + session lookup + dirPath + number generation are now in `buildArtifactRelativePathInRoot`. The old function becomes a 1-line wrapper. The existing 13 tests in `buildArtifactRelativePath` should continue to cover the wrapper (which calls the inner function).
- If coverage drops due to the delegation indirection, add a test that calls the inner function directly through the new test block, or update existing tests. Plan B: if vitest coverage flags an uncovered branch in the wrapper, add 1-2 tests for that branch.

## Rollback plan

- Revert the changes in this slice. Old function is unchanged in behavior (delegation adds a 1-line call). Caller update in `autonomous-resume-writer.ts` is a 6-line swap back. New tests are additive and can stay or be reverted.
- Time to rollback: < 5 minutes via `git revert` of the new commit.
- No DB / data migration concerns. No external API surface change.

## Commit boundary

- 1 commit on main (per [[main-branch-iteration]]): `chore(refactor): make buildArtifactRelativePath respect caller-passed projectRoot via new buildArtifactRelativePathInRoot`.
- The 3 new tests are part of the same commit. They are required for the `pnpm test` gate to stay green after the change.

## OpenSpec linkage

N/A — this is a refactor that does not need an OpenSpec change proposal. The change does not introduce a new public surface; it adds a new function. The existing `openspec/changes/` directory has 4 historical changes, none of which are about `buildArtifactRelativePath`.

## Red-line scope

(Mirrors the in-scope / out-of-scope list in `.peaks/<sid>/rd/requests/<rid>.md` "## Red-line scope" section. Duplicated here to satisfy the CLI gate-check that scans the tech-doc for this section header.)

**In-scope files** (3):
- `src/shared/change-id.ts` — new `buildArtifactRelativePathInRoot` function + delegation refactor of legacy `buildArtifactRelativePath`
- `src/services/workflow/autonomous-resume-writer.ts` — 6 call sites updated to use the new function with `artifactWorkspacePath`
- `tests/unit/change-id.test.ts` — 5 new test cases in a new `describe('buildArtifactRelativePathInRoot', ...)` block

**Out-of-scope** (deferred to follow-up slices, no modification in this refactor):
- `src/services/tech/tech-service.ts` (2 legacy call sites)
- `src/services/workflow/workflow-autonomous-service.ts` (8 legacy call sites)
- `src/services/rd/rd-service.ts` (12 legacy call sites, total 22 in the three services that the tech-doc's AD-3 misses — see code-review.md L-1)
- `src/services/session/session-manager.ts` (no changes; existing API)
- `peaks perf baseline` CLI (no changes; scaffolding + idempotent)
- `peaks request init` / `peaks request transition` (no changes; standard CLI surface)
- `tests/vitest.setup.ts` + `vitest.config.ts` (no changes; defense-in-depth from prior slice)

## Implementation evidence

(Mirrors the implementation-evidence section in `.peaks/<sid>/rd/requests/<rid>.md` "## Implementation evidence" section. Duplicated here to satisfy the CLI gate-check.)

- **Diff paths** (3 source files, ~30 lines net in change-id.ts, 6 line swaps in autonomous-resume-writer.ts, ~52 lines added in change-id.test.ts)
- **Test commands + outputs**:
  - `pnpm typecheck` → 0 errors
  - `pnpm vitest run tests/unit/change-id.test.ts` → 46/46 pass (484ms)
  - `pnpm test` (3 consecutive runs) → 121/121 files, 1744/1744 tests pass, 0 failed
  - `peaks scan request-type-sanity --type refactor` → `consistent: true`
- **Code review** → verdict: pass, 0 CRITICAL/HIGH, 0 MEDIUM, 5 LOW (doc/style only)
- **Security review** → verdict: pass, 0 CRITICAL/HIGH, 1 MEDIUM (M-1: projectRoot not canonicalized — design-intent per reviewer), 3 LOW (test-coverage)
- **Perf baseline** → N/A — no perf surface (internal refactor, no new route/hook/API/render/hot loop/N+1)
- **Dry-run output**: standards init → no delta; archetype scan → no delta; doctor → 8/8 skills pass
