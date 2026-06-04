# PRD Request 001-2026-06-04-buildartifactrelativepath-projectroot

- session: 2026-06-04-session-b60252
- type: refactor
- source: verbal (peaks-solo familiarization session, 2026-06-04)
- raw input (sanitized): user noticed that `src/shared/change-id.ts:buildArtifactRelativePath` ignores caller-passed workspace info and instead walks `process.cwd()` to find `.peaks/.session.json` from the real project root. This made 31 tests across 6 files flaky whenever the developer (or peaks-solo orchestrator) had a real session file in the project root. The fix is to make the helper respect caller-supplied workspace info, so tests with explicit tmpdir workspaces stop being polluted by the host project's session.

## Goals

- Make `buildArtifactRelativePath` accept an optional explicit `projectRoot` parameter (or equivalent workspace handle) so that callers which already have a workspace / artifactWorkspacePath in hand can pass it through.
- When caller passes a workspace-derivable `projectRoot`, the helper uses THAT for the session lookup, not `process.cwd()`. Legacy callers that don't pass anything get the existing `findProjectRoot(process.cwd())` fallback (back-compat preserved).
- Eliminate the test-suite brittleness: with the refactor, the 31 tests in `tests/unit/{tech,rd,workflow-autonomous,autonomous-resume-writer,workflow-autonomous-resume-validation,cli-program.workflow}.test.ts` should pass deterministically regardless of whether `.peaks/.session.json` is present in the host project.

## Non-goals

- No change to the **shape** of the returned path string (`.peaks/<sessionId>/<role>/<filename>` vs `.peaks/<changeId>/<segments>`). The fallback to session-based vs changeId-based is preserved.
- No new `peaks <cmd>` (per `.claude/rules/common/dev-preference.md`: skill-first, CLI only when justified).
- No change to the session-manager itself; only its consumers.
- No change to `peaks workspace init`, `peaks request init`, or any other CLI surface. This is a pure internal refactor.
- No removal of the `tests/vitest.setup.ts` stash we just added; it stays as a defense-in-depth measure and continues to make test environment deterministic.

## Preserved behavior

- Existing callers that do NOT pass an explicit projectRoot (e.g. internal helpers in `tech-service.ts`, `workflow-autonomous-service.ts`, `autonomous-resume-writer.ts`) keep their current behavior: `findProjectRoot(process.cwd())` + `getSessionId(projectRoot)`. This is the documented legacy path.
- The session-based path branch (`.peaks/<sessionId>/<role>/<filename>`) is preserved when a session is found.
- The changeId-based fallback (`.peaks/<changeId>/<segments>`) is preserved when no session is found.
- The unsafe-path / path-traversal guards (the `isUnsafeArtifactPath` checks at lines 91 and 106 of the current file) are preserved verbatim.
- All existing tests in `tests/unit/change-id.test.ts` continue to pass without modification (the local mock for session-manager at line 5 is the test's contract).

## Acceptance criteria

- `buildArtifactRelativePath(changeId, ...segments)` (no projectRoot) returns the same value as before in the legacy case (verified by `tests/unit/change-id.test.ts` existing assertions).
- A new optional `projectRoot` parameter, when passed, is used in place of `findProjectRoot(process.cwd())` for the session lookup AND for the dirPath used by `getNextNumber`.
- The 31 tests in `tests/unit/{tech,rd,workflow-autonomous,autonomous-resume-writer,workflow-autonomous-resume-validation,cli-program.workflow}.test.ts` pass deterministically regardless of `.peaks/.session.json` presence at the host project root. (Defense-in-depth: even if `tests/vitest.setup.ts` is removed, the tests still pass.)
- New unit tests cover the caller-passed projectRoot path: same `changeId` + different `projectRoot` arguments produce different result shapes (session-based vs changeId-based) when only one of the two roots has a session file.
- No regression in any of the 1739 existing tests.
- `pnpm typecheck` passes.
- Coverage on the modified function stays at 100% (or is added to `coverage.exclude` with a one-line reason per the [[coverage-red-line]] pattern).

## Frontend delta (only when target is frontend)

N/A — this is a backend / CLI refactor, no user-visible UI surface.

## Risks and open questions

- **Risk**: a future caller might pass a `projectRoot` that is NOT inside the actual session binding's project root. This could cause session-based paths to point to non-existent directories. Mitigation: the existing `isInsidePath` guard in `workspace-service.ts` is the right pattern; we may need to add a similar guard here, but it is out of scope for this slice (callers are all internal and trusted).
- **Open question**: should we expose `projectRoot` as a required parameter (breaking change) or as optional with a default fallback? Choosing optional for back-compat. If a future major version wants to make it required, that is a separate `breaking-change` slice.
- **Open question**: how should we document the new parameter in JSDoc? The current function has a JSDoc block above it; need to add a `@param` for the new optional arg.

## Handoff

- to peaks-rd: .peaks/2026-06-04-session-b60252/rd/requests/001-2026-06-04-buildartifactrelativepath-projectroot.md
- to peaks-qa: .peaks/2026-06-04-session-b60252/qa/requests/001-2026-06-04-buildartifactrelativepath-projectroot.md

## Status

- created: 2026-06-04T03:32:44.513Z
- last update: 2026-06-04T03:34:15.533Z
- state: handed-off
