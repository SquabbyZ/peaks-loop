# Tasks: fix-claude-settings-template-hook-node-wrapper

> Execute with TDD. Every implementation step that adds behavior starts with a failing test. Do not widen scope to other settings-local hooks or unrelated workspace code in this change.
>
> **Status reconciliation (2026-07-24):** Tasks 1-5 are **already implemented** on HEAD (`e51797c3`). The original proposal named `buildBashHookCommand` (a function that pre-dates the v3.1.2 gate-step-08 refactor); the actual builders on HEAD are `buildWriteHookCommand()` (wrapped via `wrapAsNodeOneLiner`) and `buildBashGateStep08Command()` (intentionally NOT wrapped — CLI delegation). Tasks 1-5 below record the historical TDD plan and the commit refs that landed the implementation. Tasks 6-9 remain open.

## 1. Failing test for the wrapper prefix

- [x] **Already implemented** (commit `8411fe88`, 2026-06-13).
- [x] Add unit test asserting `buildWriteHookCommand()` returns a string starting with `node -e "` and ending with `"`.
- [x] Add unit test asserting the wrapped form preserves the `wrapAsNodeOneLiner(js)` contract.
- [x] Run `pnpm test -- tests/unit/workspace/claude-settings-template.test.ts` — 18/18 pass (GREEN).
- Note: the original task named `buildBashHookCommand()` which does not exist on HEAD; the equivalent Bash matcher is now `buildBashGateStep08Command()` and is **intentionally NOT wrapped** — see Task 5 addendum.

## 2. Failing test for JSON-escape contract

- [x] **Already implemented** (commit `8411fe88`, 2026-06-13).
- [x] Add unit test asserting the embedded JS double quotes are escaped as `\\"` (backslash-quote) inside the wrapper.
- [x] Add unit test asserting the round-trip: `JSON.stringify(buildClaudeSettingsLocalJson())` produces a string where the Write/Edit/MultiEdit `command` field, when split out and parsed, contains a node-executable payload (no raw `"` that would close the wrapper prematurely).
- [x] Run `pnpm test` — all tests pass (GREEN).

## 3. Failing test for argv index contract

- [x] **Already implemented** (commit `8411fe88`, 2026-06-13).
- [x] Add unit test exercising the chosen argv index slot with a candidate command string and asserting the helper reads the candidate and decides allow vs deny correctly. The slot is `process.argv[1]` per Node.js argv layout under `-e`.
- [x] Run `pnpm test` — all tests pass (GREEN).

## 4. Implementation: wrap with `node -e`

- [x] **Already implemented** (commit `8411fe88`, 2026-06-13).
- [x] Modify `buildWriteHookCommand()` to wrap its inner JS in `node -e "<js>"`, JSON-escaping every embedded `"` as `\\"`.
- [x] Update the docstring in `claude-settings-template.ts` to drop the `argv[2]` reference and standardize on `argv[1]` (line 200-201 of HEAD).
- [x] Update existing unit-test fixtures that asserted the old unwrapped form so they assert the wrapped form.
- [x] Run `pnpm test` — all new + updated tests pass (GREEN).
- Note: the Bash matcher was **not** wrapped in `node -e`. The v3.1.2 refactor (commit `d9a1a098`, 2026-07-04) replaced the old `buildBashHookCommand` with `buildBashGateStep08Command()` which returns the literal `peaks code gate-step-08 --project "${CLAUDE_PROJECT_DIR}"` CLI invocation. CLI delegation is the load-bearing contract — wrapping would break the mechanical gate.

## 5. Refactor and shared helper

- [x] **Already implemented** (commit `8411fe88`, 2026-06-13).
- [x] Extract a single internal helper `wrapAsNodeOneLiner(js: string): string` so the wrapper / escape contract lives in one place (lines 170-180 of HEAD).
- [x] Confirm `buildWriteHookCommand` goes through the helper.
- [x] Confirm tests still pass.
- Addendum (v3.1.2, commit `d9a1a098`): `buildBashGateStep08Command` does NOT go through `wrapAsNodeOneLiner` — by design. The Bash matcher delegates to the CLI; exit code is the gate-step-08 signal (0 = allow, 2 = block). The no-wrapper decision is documented in the `buildBashGateStep08Command` docstring (lines 261-269 of HEAD).

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