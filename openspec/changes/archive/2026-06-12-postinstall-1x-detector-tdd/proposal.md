# Change: 2026-06-12-postinstall-1x-detector-tdd

## Why

The 1.x → 2.0 postinstall scaffold in `scripts/install-skills.mjs` (the 8-IDE fan-out for the Trae user fix, plus `detect1xProjectState` and `autoUpgrade1xProjectIfPresent`) was added in the previous session but ships without TDD coverage for the new detection / auto-upgrade paths. The integration test (`tests/integration/ide/install-skills-dispatch.test.ts`) only covers the 8-platform symlink dispatch, not the 1.x detection logic. Per the peaks-loop dev-preference "dogfood on every adjustment" rule, the auto-upgrade path needs an end-to-end dogfood on the current repo to prove the 1.x → 2.0 signals fire correctly when `npm i -g peaks-loop@2.0` runs in a 1.x consumer project.

## What Changes

- Add unit-test coverage for `detect1xProjectState` in a new `tests/unit/scripts/install-skills-1x-detector.test.ts` — fixtures cover: legacy 1.x global config, dev-preference.md referencing 'peaks progress', missing .peaks/preferences.json, non-1.x schema_version, no .peaks/_runtime/, and the happy-path (no 1.x signals).
- Add unit-test coverage for `autoUpgrade1xProjectIfPresent` in the same file — fixtures cover: PEAKS_SKIP_AUTO_UPGRADE=1, no 1.x state, valid 1.x state with successful spawnSync, valid 1.x state with failed spawnSync. Mock the spawnSync call to avoid invoking the real peaks binary during unit tests.
- Extend `tests/integration/ide/install-skills-dispatch.test.ts` with one end-to-end test that runs the postinstall inside a temp project containing a 1.x fixture (legacy ~/.peaks/config.json + dev-preference.md) and asserts the auto-upgrade path is reached (via the spawnSync mock on the detection side, real spawn on the umbrella side).
- Add a dogfood script `scripts/dogfood-postinstall-1x.mjs` that creates a temp dir with a 1.x fixture, runs the postinstall against it, and writes a markdown report to `.peaks/_runtime/<sid>/rd/postinstall-1x-dogfood.md`. The report must show: (a) detect1xProjectState returned isOneX=true, (b) autoUpgrade1xProjectIfPresent dispatched, (c) the umbrella's sub-step results (config-migrate / standards-migrate / memory-extract / hooks-install / skill-sync / audit-verify), (d) the exit code.
- **Regression fix**: the 8-IDE fan-out in `installBundledSkillsForAllPlatforms` (added in the previous session) lost the `PEAKS_CLAUDE_SKILLS_DIR` / `PEAKS_CLAUDE_OUTPUT_STYLES_DIR` back-compat precedence for the claude-code install. Four pre-existing tests now fail (`tests/integration/ide/install-skills-dispatch.test.ts` x3 + `tests/unit/install-skills-script.test.ts` x1). Fix: in the platform-iteration loop, pass the env-var override as the `targetRoot` for the claude-code install (and similarly for the claude-code output-style install). The other 7 platforms keep their per-IDE profile paths. This restores the legacy back-compat contract that user `set PEAKS_CLAUDE_SKILLS_DIR=...` still works even in 2.0's fan-out mode.

## Out of Scope

- Lifting `detect1xProjectState` from `.mjs` into a TypeScript service (that is Slice 3: peaks-solo Step 0.55).
- Thinning `.claude/rules/**/*.md` in consumer projects (that is Slice 2: standards migrate --from-claude-rules).
- Modifying the umbrella `peaks upgrade --to 2.0` (Slice 1 only touches the postinstall side).
- Adding new tests for `installBundledSkills` or `installBundledOutputStyles` (existing integration test already covers those paths).

## Dependencies

- `scripts/install-skills.mjs:detect1xProjectState` (already shipped in previous session).
- `scripts/install-skills.mjs:autoUpgrade1xProjectIfPresent` (already shipped in previous session).
- `tests/integration/ide/install-skills-dispatch.test.ts` (existing dispatch test fixture).

## Risks

- Spawning the real `peaks` binary in the integration test may fail in CI where the global binary is not on PATH — mitigation: use the local `node bin/peaks.js` invocation path that the umbrella service already uses, with a fixture peaks.js shim.
- Mocking spawnSync in unit tests must preserve the contract that the umbrella sees (return shape with status/stdout/stderr) — the unit test must assert on the return shape, not just call count.
- The dogfood script must not pollute the real `~/.peaks/config.json` — set HOME to a tempdir for the test run.

## Acceptance Criteria

- `pnpm vitest run tests/unit/scripts/install-skills-1x-detector.test.ts` passes with ≥6 cases (legacy global config / dev-preference.md with peaks progress / missing preferences.json / 1.x schema_version / no 1.x state / no .peaks/_runtime/).
- `pnpm vitest run tests/unit/scripts/install-skills-1x-detector.test.ts` passes with ≥4 cases for autoUpgrade1xProjectIfPresent (PEAKS_SKIP_AUTO_UPGRADE=1 / no 1.x state / successful spawn / failed spawn).
- `pnpm vitest run tests/integration/ide/install-skills-dispatch.test.ts` passes with the new auto-upgrade end-to-end test added.
- `node scripts/dogfood-postinstall-1x.mjs` produces a report showing detect1xProjectState isOneX=true and autoUpgrade1xProjectIfPresent.ran=true. Report is committed under `.peaks/_runtime/<sid>/rd/postinstall-1x-dogfood.md` (git-ignored runtime, not committed).
- Full `pnpm vitest run` is green (no regressions).
- `pnpm tsc -p tsconfig.json --noEmit` is clean (no type regressions from new test files).
- `peaks slice check` for the new test files passes stages 1-6 (typecheck / unit-tests / review-fanout / gate-verify-pipeline / mock-placement / audit-regression).
