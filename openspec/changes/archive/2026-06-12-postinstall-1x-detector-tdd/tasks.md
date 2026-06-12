# Tasks

## Unit-test detect1xProjectState

- [ ] Create tests/unit/scripts/install-skills-1x-detector.test.ts with vitest fixtures
- [ ] Add 6 test cases for the detection function (legacy global config / dev-preference.md / missing preferences.json / 1.x schema / no .peaks/_runtime/ / happy path)
- [ ] Run pnpm vitest run tests/unit/scripts/install-skills-1x-detector.test.ts — confirm all pass

## Unit-test autoUpgrade1xProjectIfPresent

- [ ] Mock child_process.spawnSync in the test file
- [ ] Add 4 test cases (PEAKS_SKIP_AUTO_UPGRADE=1 / no 1.x state / successful spawn / failed spawn)
- [ ] Run pnpm vitest run — confirm all pass

## Integration test for end-to-end auto-upgrade

- [ ] Extend tests/integration/ide/install-skills-dispatch.test.ts with a new test that runs the postinstall in a temp project containing 1.x fixtures
- [ ] Assert the auto-upgrade path is reached by intercepting the spawned peaks binary
- [ ] Run pnpm vitest run — confirm the new test passes alongside the existing 8-platform tests

## Dogfood script + report

- [x] Create scripts/dogfood-postinstall-1x.mjs that scaffolds a 1.x temp project and runs the postinstall
- [x] Set HOME to a tempdir so the global ~/.peaks/config.json is not polluted
- [x] Capture the detect1xProjectState result + autoUpgrade1xProjectIfPresent result + umbrella sub-step results
- [x] Write the report to .peaks/_runtime/<sid>/rd/postinstall-1x-dogfood.md

## Regression fix — PEAKS_CLAUDE_*_DIR back-compat in 8-IDE fan-out

- [ ] In scripts/install-skills.mjs:installBundledSkillsForAllPlatforms, pass `targetRoot: process.env.PEAKS_CLAUDE_SKILLS_DIR` when ideId === 'claude-code' (so the env-var override still wins for the claude-code install)
- [ ] In the output-style fan-out, pass `targetRoot: process.env.PEAKS_CLAUDE_OUTPUT_STYLES_DIR` when ideId === 'claude-code' (same precedence fix)
- [ ] Re-run pnpm vitest run tests/integration/ide/install-skills-dispatch.test.ts — all 5 tests pass
- [ ] Re-run pnpm vitest run tests/unit/install-skills-script.test.ts — all 38 tests pass (3 skipped as before)

## Validation gates

- [x] pnpm vitest run tests/unit/scripts/install-skills-1x-detector.test.ts — 14/14 pass
- [x] pnpm vitest run tests/integration/ide/install-skills-dispatch.test.ts (pre-fix baseline) — 2/5 pass (3 fail — documented)
- [ ] pnpm vitest run tests/integration/ide/install-skills-dispatch.test.ts (post-fix) — 5/5 pass
- [ ] pnpm vitest run tests/unit/install-skills-script.test.ts — 38/38 pass
- [ ] pnpm vitest run — full suite green (no regressions)
- [ ] pnpm tsc -p tsconfig.json --noEmit — clean
- [ ] Run peaks slice check on the slice — stages 1-6 all PASS
- [x] Capture the dogfood report path in the QA validation report (postinstall-1x-dogfood.md)
