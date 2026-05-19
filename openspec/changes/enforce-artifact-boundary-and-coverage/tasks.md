# Tasks: enforce-artifact-boundary-and-coverage

> Implement before or alongside planner changes. Use TDD for shared validation helpers.

## 1. Change id validation

- [ ] Add unit tests for valid change ids.
- [ ] Add unit tests rejecting empty ids, `.`, `..`, path separators, drive prefixes, URL-like strings, and traversal.
- [ ] Implement a shared change id validator.
- [ ] Reuse the validator in tech and RD planner commands.

## 2. Artifact path planning helpers

- [ ] Add unit tests for artifact-relative path generation.
- [ ] Add unit tests proving paths stay under the configured artifact workspace after resolution.
- [ ] Add unit tests proving JSON output uses `/` separators on Windows and Unix.
- [ ] Implement shared artifact path helper functions.
- [ ] Keep path templates internal and do not accept arbitrary artifact paths from CLI input.

## 3. Workspace unavailable responses

- [ ] Add unit tests for preview-only response when dry-run persistence is not required.
- [ ] Add unit tests for blocked response when persistence is required.
- [ ] Implement a common response shape for unavailable artifact workspace.
- [ ] Ensure commands do not create `.peaks/changes/<change-id>/...` under the target repository by default.

## 4. Coverage gate

- [ ] Add or update tests that assert coverage thresholds are 100% for statements, branches, functions, and lines.
- [ ] Keep newly included modules covered by unit tests instead of excluding them.
- [ ] Run `pnpm test:coverage` and fix gaps.

## 5. Verification

- [ ] Run `pnpm test`.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm test:coverage`.
- [ ] Run code review agent after implementation changes.
- [ ] Run security reviewer for path validation and artifact boundary changes.
