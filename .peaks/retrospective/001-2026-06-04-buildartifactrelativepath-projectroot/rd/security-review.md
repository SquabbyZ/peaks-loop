# Security Review: buildArtifactRelativePath projectRoot refactor

- session: 2026-06-04-session-b60252
- rid: 001-2026-06-04-buildartifactrelativepath-projectroot
- type: refactor
- linked-prd: .peaks/2026-06-04-session-b60252/prd/requests/001-001-2026-06-04-buildartifactrelativepath-projectro.md
- reviewer: security-reviewer (peaks-rd fan-out)
- scope: `src/shared/change-id.ts`, `src/services/workflow/autonomous-resume-writer.ts`, `tests/unit/change-id.test.ts`
- review date: 2026-06-04

## Summary

The refactor adds a new sibling function `buildArtifactRelativePathInRoot(projectRoot, changeId, ...segments)` to `src/shared/change-id.ts` and converts the existing `buildArtifactRelativePath` into a 1-line delegation wrapper. The 6 call sites in `autonomous-resume-writer.ts` now pass the caller-supplied `artifactWorkspacePath` as the new first arg, so the helper no longer walks `process.cwd()` to discover a session. Threat-model-wise, the only caller of the new function in this slice (`autonomous-resume-writer.ts:139-159`) threads the user-controlled `--project` CLI flag through to the new first arg. **No new attack surface is introduced**: `changeId` is still validated first (`validateChangeIdOrThrow` rejects traversal, slashes, drive prefix, URL patterns), and the relative path components (`role`, `sessionId`, joined `segments`, full `candidatePath`) are still gated by `isUnsafeArtifactPath` in both branches. The legacy wrapper's surface is byte-identical to before the refactor (`findProjectRoot(process.cwd()) ?? process.cwd()`). No new external API surface, no new dependencies, no hardcoded secrets, no command injection vectors. The one residual MEDIUM finding is that the new `projectRoot` parameter is not canonicalized (no realpath) before being joined with `.peaks/<sessionId>/<role>`, which expands the writable path set compared to the pre-refactor `findProjectRoot`-bounded behavior — but this expansion is the documented, intentional design goal of the slice (CLI flag = trust boundary), and the inner relative path is still hard-validated.

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

**M-1. `buildArtifactRelativePathInRoot` does not canonicalize or bound the caller-supplied `projectRoot`**

- file:line: `src/shared/change-id.ts:98-105`
- detail: The new function accepts any non-empty string for `projectRoot` and passes it directly to `getSessionId(resolvedProjectRoot)` and `join(resolvedProjectRoot, '.peaks', sessionId, role)`. There is no realpath/canonicalization, no `isAbsolute()` check, no rejection of `..` segments, and no `isUnsafePathInput` validation. A caller that supplies a relative path, a path containing `..`, or a path with symlinks could cause:
  - Session lookup to read a `.peaks/.session.json` from a directory the caller did not intend.
  - `getNextNumber(dirPath)` to `readdirSync` an unexpected directory.
  - With `apply=true` in `autonomous-resume-writer.ts`, `writeFile` to land in an unexpected location.
- attack-vector assessment: In the only in-scope caller (`autonomous-resume-writer.ts:139-159`), the `artifactWorkspacePath` is the user-controlled `--project` CLI flag, validated only for non-empty in `runAutonomousResumeInit` (`src/cli/commands/workflow-commands.ts:271-273`). The intended user can write to any directory they have permission to write to via `--project <dir>`. This is the **documented** CLI behavior and the design goal of the refactor, not a regression. The changeId + role + sessionId + segments + candidatePath *internal* path is still hard-validated. The expanded surface is "user can write to a directory they can already write to via `mkdir -p && writeFile`", which is the standard `--project <dir>` UX. **Pre-refactor**: `findProjectRoot(process.cwd())` bounded writes to the project root. **Post-refactor**: writes follow the CLI flag. This is a feature, not a bug — but it should be acknowledged in the threat model (it is, in the tech-doc AD-3).
- recommendation: Document the trust boundary in the JSDoc for `buildArtifactRelativePathInRoot` more explicitly. The current JSDoc says "Must be an absolute path" but the code does not enforce this. Either (a) tighten the contract: throw on non-absolute, or (b) loosen the JSDoc to "Caller is responsible for validating the path; this function does not bound the write target." Option (a) would catch relative paths and prevent silent CWD-anchoring. A `path.isAbsolute(projectRoot)` check is one line. Out of scope for this refactor slice but worth a follow-up.

### LOW

**L-1. Empty-projectRoot test does not actually verify the `findProjectRoot(process.cwd())` fallback is invoked**

- file:line: `tests/unit/change-id.test.ts:175-183`
- detail: The test passes `''` and `mockGetSessionId.mockReturnValue(null)`, then asserts the result is `.peaks/degraded-change/rd`. Because `getSessionId` is stubbed to return null regardless of input, the result is the same for any `projectRoot` (including `''` itself). The test does not verify that the function actually resolved `''` to the `findProjectRoot` fallback path. A regression that silently treats `''` as the project root would not be caught.
- recommendation: Either (a) mock `findProjectRoot` to assert it was called, or (b) use a non-empty-but-degenerate projectRoot and verify the relative path is computed against the resolved fallback. The current test is documenting *intent* rather than *behavior*. Low priority — a test-coverage gap, not a security issue.

**L-2. The two-different-projectRoots test does not cover the `getNextNumber`/`readdirSync` side effect**

- file:line: `tests/unit/change-id.test.ts:159-173`
- detail: The "defense against cross-workspace pollution" test verifies the *relative* path differs by projectRoot. It does not exercise `getNextNumber(dirPath)` against a real tmpdir to confirm that the `dirPath` used for `readdirSync` (and any future `mkdirSync`/counter writes) is bound to the caller-supplied projectRoot. This is the actual side-effect surface of the refactor; a regression there would be silent (counter would advance against the wrong directory).
- recommendation: Add one integration-style test that creates two tmpdir workspaces, writes a `.peaks/.session.json` with the same sessionId into one of them, and confirms `getNextNumber` is called on `<that-workspace>/.peaks/<sessionId>/<role>` and not on the other. Out of scope for this slice but worth noting for the next pass.

**L-3. Legacy `buildArtifactRelativePath` delegation is structurally identical but the delegation hop is not explicitly covered by a regression test**

- file:line: `src/shared/change-id.ts:148-154`
- detail: The legacy function now delegates to `buildArtifactRelativePathInRoot(findProjectRoot(process.cwd()) ?? process.cwd(), changeId, ...segments)`. The 13 existing tests in the `buildArtifactRelativePath` describe block pass through to the new function. If `findProjectRoot` is changed (e.g. to return `null` more often), the legacy wrapper's behavior is preserved by the `?? process.cwd()` fallback. This is fine; just noting that the delegation is not pinned by a test that asserts "legacy wrapper = legacy implementation" beyond the existing per-case coverage. Low priority.

## Required Fixes (CRITICAL + HIGH)

None. The slice is safe to merge from a security perspective.

## Recommended (MEDIUM + LOW)

- M-1: Either tighten the JSDoc contract for `buildArtifactRelativePathInRoot.projectRoot` to match what the code does ("caller is responsible for path validation"), or add a `path.isAbsolute(projectRoot)` check that throws on relative input. Recommend doing this in a follow-up slice — the current behavior is intentional and gated by the CLI's `--project` flag.
- L-1: Tighten the empty-projectRoot test to assert the `findProjectRoot` fallback is actually called. ~3 lines.
- L-2: Add a tmpdir integration test that verifies `getNextNumber`'s `dirPath` is bound to the caller-supplied projectRoot. ~10 lines. Out of scope for this slice.
- L-3: No action required. The existing 13 legacy tests indirectly cover the delegation.

## Threat-model walkthrough

1. **Caller-controlled `projectRoot`** (`src/cli/commands/workflow-commands.ts:271-273`): The `--project` CLI flag is non-empty validated only. A user can pass any path. The function trusts the user's choice — this is the intended feature.

2. **`changeId` validation** (`src/shared/change-id.ts:96`, `validateChangeIdOrThrow`): Runs FIRST. Rejects `..`, `/`, `\`, drive prefix (`C:`), URL patterns, `@host:path`, dot-only. Test covers this branch (`tests/unit/change-id.test.ts:185-190` confirms `getSessionId` is NOT called when changeId is invalid).

3. **Session lookup** (`src/shared/change-id.ts:101`, `getSessionId(resolvedProjectRoot)`): `readFileSync(join(resolvedProjectRoot, '.peaks', '.session.json'))`. Bounded by the resolved projectRoot. The session file's stored `projectRoot` field is compared with strict equality (`session-manager.ts:134`), so a `.peaks/.session.json` for a different project will be ignored.

4. **`role` (first segment) validation** (`src/shared/change-id.ts:104-108`): `normalizeForwardSlashes` + `isUnsafeArtifactPath(role) || isUnsafeArtifactPath(sessionId)`. Rejects traversal. The sessionId comes from the session file, not from user input.

5. **`getNextNumber(dirPath)`** (`src/shared/change-id.ts:111`): `readdirSync(join(resolvedProjectRoot, '.peaks', sessionId, role))`. Read-only. No write side-effect from `getNextNumber` itself (verified in `src/shared/incrementing-number.ts:17-31`: only `existsSync` + `readdirSync`).

6. **`candidatePath` validation** (`src/shared/change-id.ts:122`): `isUnsafeArtifactPath(joined) || isUnsafeArtifactPath(candidatePath)`. Rejects traversal in either the joined segments or the full relative path. Defense-in-depth.

7. **Final write** (`src/services/workflow/autonomous-resume-writer.ts:183-184`, `mkdir(dirname(file.path), { recursive: true })` + `writeFile(file.path, file.content)`): The `file.path` is `join(artifactWorkspacePath, buildArtifactRelativePathInRoot(...))`. The relative part is safe. The `artifactWorkspacePath` is user-controlled. With `apply=true`, the user is explicitly opting in to writing to that workspace.

8. **Legacy `buildArtifactRelativePath`** (`src/shared/change-id.ts:148-154`): Delegates to the new function with `findProjectRoot(process.cwd()) ?? process.cwd()`. Byte-identical surface to pre-refactor. All 13 existing tests in the `buildArtifactRelativePath` describe block pass unchanged.

9. **Empty-string fallback** (`src/shared/change-id.ts:98-100`): Defensive only. If `projectRoot` is the empty string, falls back to `findProjectRoot(process.cwd()) ?? process.cwd()`. The fallback path is `process.cwd()`, NOT the empty string. The empty string is never joined with `.peaks`. The pre-refactor code had the same behavior (the old `findProjectRoot(process.cwd()) ?? process.cwd()` did the same thing).

## What is NOT in scope of this slice

- `tech-service.ts` (2 call sites) and `workflow-autonomous-service.ts` (8 call sites) still call the legacy `buildArtifactRelativePath`. They are still vulnerable to the original "host project's `.peaks/.session.json` pollutes the result" bug if their tests ever run with a real session binding. This is documented in `tech-doc.md` AD-3 as a deliberate scoping decision. The `tests/vitest.setup.ts` stash is defense-in-depth.
- `--project` CLI flag validation: out of scope. The CLI is the trust boundary; if a user wants to write to `/etc`, that's their call (and their OS permissions will reject it).

## Verdict

**pass** — no blocking security issues. The refactor preserves all existing path-safety guarantees and the new `projectRoot` parameter is gated by the intended caller (the CLI's `--project` flag, which is the documented trust boundary). M-1 is a real expansion of the write surface, but it is the intentional design goal of the slice, not a regression. L-1/L-2 are test-coverage improvements that can land in a follow-up.

## Cross-references

- `tech-doc.md` AD-1: rationale for the sibling-function shape.
- `tech-doc.md` AD-2: rationale for `getSessionId` (strict) vs. `getSessionIdCanonical`.
- `tech-doc.md` AD-3: rationale for limiting caller updates to `autonomous-resume-writer.ts` only.
- `src/shared/change-id.ts:18-29` `hasUnsafePathShape`: the core path-safety primitive.
- `src/services/session/session-manager.ts:128-141` `readSessionFile`: strict-equality session lookup, the read-side guard that limits M-1's blast radius.
- `src/cli/commands/workflow-commands.ts:269-292` `runAutonomousResumeInit`: the only in-scope caller of the new function via the CLI; `--project` is the user trust boundary.
