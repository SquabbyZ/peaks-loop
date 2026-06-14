# Tasks: fix-claude-settings-template-hook-node-wrapper

> Execute with TDD. Every implementation step that adds behavior starts with a failing test. Do not widen scope to other settings-local hooks or unrelated workspace code in this change.

## 1. Failing test for the wrapper prefix

- [ ] Add unit test asserting `buildBashHookCommand()` returns a string starting with `node -e "` and ending with `"`.
- [ ] Add unit test asserting `buildWriteHookCommand()` returns a string with the same shape.
- [ ] Run `pnpm test -- tests/unit/workspace/claude-settings-template.test.ts` and confirm both tests fail (RED).

## 2. Failing test for JSON-escape contract

- [ ] Add unit test asserting the embedded JS double quotes are escaped as `\\"` (backslash-quote) inside the wrapper.
- [ ] Add unit test asserting the round-trip: `JSON.stringify(buildClaudeSettingsLocalJson())` produces a string where the `command` field, when split out and parsed, contains a node-executable payload (no raw `"` that would close the wrapper prematurely).
- [ ] Run `pnpm test` and confirm the new tests fail (RED).

## 3. Failing test for argv index contract

- [ ] Add unit test exercising the chosen argv index slot with a candidate command string and asserting the helper reads the candidate and decides allow vs deny correctly.
- [ ] Run `pnpm test` and confirm the test fails (RED) on the current implementation.

## 4. Implementation: wrap with `node -e`

- [ ] Modify `buildBashHookCommand()` to wrap its inner JS in `node -e "<js>"`, JSON-escaping every embedded `"` as `\\"`.
- [ ] Modify `buildWriteHookCommand()` to apply the same wrapper.
- [ ] Update the docstring in `claude-settings-template.ts` to drop the `argv[2]` reference and standardize on `argv[1]` (or whichever slot Claude Code actually passes — confirm against `Claude Code` hook spec).
- [ ] Update existing unit-test fixtures that asserted the old unwrapped form so they assert the wrapped form.
- [ ] Run `pnpm test` and confirm all new + updated tests pass (GREEN).

## 5. Refactor and shared helper

- [ ] Extract a single internal helper `wrapAsNodeOneLiner(js: string): string` so the wrapper / escape contract lives in one place.
- [ ] Confirm both `buildBashHookCommand` and `buildWriteHookCommand` go through the helper.
- [ ] Confirm tests still pass.

## 6. Cross-platform dogfood

- [ ] On Windows (current machine), run `peaks workspace init --no-claude-hooks --project . --json` then `peaks workspace init --force-hooks --project . --json`, read the resulting `.claude/settings.local.json`, and spawn the `command` field via Node child_process to assert exit 0 for `peaks workspace init --project . --json` and exit 1 for `npm install foo`.
- [ ] On a macOS runner (CI or local), repeat the dogfood and capture identical exit-code behavior. If a macOS runner is unavailable in this iteration, document the gap in the PR description and defer to a follow-up issue.
- [ ] On Linux runner (if available), repeat again.

## 7. Quality gates

- [ ] Run `pnpm test`.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm test:coverage`.
- [ ] Confirm the changed module's coverage still meets the project floor.

## 8. Review

- [ ] Run code-review agent after code changes.
- [ ] Run TypeScript reviewer (changed module is TypeScript).
- [ ] Run security reviewer (the hook allows arbitrary Bash calls within the allow-list — confirm the allow-list is unchanged and the wrapper doesn't widen it).
- [ ] Fix CRITICAL and HIGH findings before marking complete.

## 9. Release

- [ ] Bump version 2.0.3 → 2.0.4 (hotfix).
- [ ] Update CHANGELOG.md with a hotfix entry describing the symptom (all Bash + Write tool calls blocked on clean 2.0.3 install) and the resolution (wrap hook command in `node -e`).
- [ ] Commit, push, open PR, merge to main, tag `v2.0.4`.
- [ ] Confirm a fresh install of 2.0.4 no longer exhibits the symptom on Windows + macOS.