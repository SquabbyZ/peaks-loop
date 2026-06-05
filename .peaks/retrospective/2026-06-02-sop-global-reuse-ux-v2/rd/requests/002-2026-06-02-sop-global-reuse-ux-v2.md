# RD Request 2026-06-02-sop-global-reuse-ux-v2

- session: 2026-06-02-session-prd003ux
- linked-prd: .peaks/2026-05-29-session-746113/prd/requests/005-2026-06-02-sop-global-reuse-ux-v2.md
- linked-ui: N/A
- type: feature (ux-fix)

## Red-line scope

**In-scope (paths and behavior):**

- `src/cli/commands/sop-commands.ts` line 188 — add `defaultValue: '.'` to `sop registry --project` option so that `peaks sop registry` merges the project layer by default.
- `tests/unit/sop-commands.test.ts` — add ONE test that exercises `sop registry` with no `--project` (cwd has `<cwd>/.peaks/sops/registry.json`) and asserts the merged view contains the project-layer entry; add ONE assertion (or extend an existing test) that the registry command does not throw when run from a non-project cwd.

**Out-of-scope (explicitly do not touch):**

- `src/services/sop/sop-check-service.ts` — `evaluateGrep` (G4 already implemented; AC1/AC2 covered by `sop-check-service.test.ts:69` and `sop-project-layer.test.ts:32`).
- `src/services/sop/sop-advance-service.ts` — `assertNoPhaseSkip` (G5 already implemented; AC3 covered by `sop-advance-service.test.ts:136`).
- `src/cli/commands/sop-commands.ts` `sop init` action (line 75-103) — `nextActions` shape already implemented; AC5 covered by `sop-commands.test.ts:47,59,60`.
- `src/cli/commands/sop-commands.ts` lines 209/236 (`sop check` and `sop advance` `--project` defaults) — already default to `.`.
- `src/cli/commands/gate-commands.ts` line 50/100 (`sop gate enforce` and `sop gate bypass` `--project` defaults) — already default to `.`.
- `src/services/sop/sop-paths.ts`, `sop-registry-service.ts` — readRegistry, project layer merging logic (PRD 004 Slice 2 implementation; preserved behavior per P6).
- `src/services/sop/sop-types.ts` — `absent?: boolean` field already declared.
- `openspec/changes/` — not creating a new change; the prior 003/004 PRDs also did not. This iteration is one CLI default + one test.
- `package.json` — no new dependencies.

## Standards preflight

- `peaks standards init --project . --dry-run --json` — no missing standards files reported.
- `peaks standards update --project . --dry-run --json` — no drift.
- All four Gate A3 files exist (CLAUDE.md, .claude/rules/common/{coding-style,code-review,security}.md) plus typescript-specific coding-style.
- planned application: **review-only** (no new rule content needed; existing rules already cover immutable patterns, error handling, and the coverage red-line that the SOP CLI already follows).

## OpenSpec linkage

- No change. The project has `openspec/`, but the prior PRD 003 (sop global reuse) and PRD 004 (gate hook) iterations did not create `openspec/changes/003-*` or `004-*` either. This iteration is a single CLI default-value change plus one test — below the bar the prior engineering-level changes (e.g. `add-tech-dry-run-gate`, `enforce-artifact-boundary-and-coverage`) used.

## OQ answers (from PRD 005 v2)

- **OQ1** (G5 phase-skip adjacent rule): PRD 003 v2 PRD said "PRD倾向前者(下标邻接)". Current implementation `assertNoPhaseSkip` in `sop-advance-service.ts:121-133` uses **phases-array-index + 1**. **Accepted as-is** — matches PRD 003 v2 inclination; the optional `transitions: {…}` field for explicit overrides is out of scope this round (R2 risk already documented in PRD).
- **OQ2** (G6 nextActions `register` step on lint failure): The current `sop.init` action only lists `Edit manifestPath` + `sop lint`, not `sop register`. **Accepted as-is** — registering before lint passes is invalid (registry could ship broken gates), so listing it as the immediate next step would mislead. PRD R1 / AC5 wording does not require `register` in `nextActions`.
- **OQ3** (G7 cwd→projectRoot probe): There is no shared "is cwd a project root?" helper. For this iteration, the change is limited to `sop registry` and we rely on `readRegistry('.')` to merge gracefully (empty if no project layer). For `sop check` / `sop advance` / `sop gate enforce`, the `--project .` default is already in place. If a future iteration introduces a single dispatch helper, it should be extracted then — **not this round** (YAGNI; P3 / R3 already covered by SKILL.md guidance).

## Coverage status

- Pre-iteration total UT coverage: ~88% (existing project baseline, not blocked — see baseline memory).
- New/changed code in this slice: 1 line of CLI default + ~30 lines of test code.
- Expected post-iteration coverage for the changed file (`sop-commands.ts`): unchanged or +0.1% (the change is a default-value addition; the action body is unchanged).
- Test code coverage target: meaningful behavior assertions, no padding (per `coverage-red-line` memory).
- gate verdict (post-implementation): pass — see "Implementation evidence" below for the recorded numbers.

## Slice contract

- **Slice id**: `sop-registry-cwd-default-v2`
- **Functional boundary**: `peaks sop registry` command's `--project` option default; one test in `sop-commands.test.ts`.
- **Pre-slice behavior**: `peaks sop registry` without `--project` returns the **global-only** view (because `options.project` is `undefined` → `readRegistry(undefined)` skips the project layer merge).
- **Target structure**: `peaks sop registry` without `--project` returns the **global + project-layer merged** view (because `options.project` defaults to `.` → `readRegistry('.')` finds `<cwd>/.peaks/sops/registry.json` if present and merges).
- **Unit-test requirements** (per `coverage-red-line`):
  - Test 1: in a temp project with a project-layer registry entry, run `peaks sop registry` with no `--project` flag and assert the response `data.sops` (or the equivalent merged-view field) contains the project-layer entry. This is a behavior assertion, not a branch-coverage assertion.
  - Test 2 (or extension of Test 1): in a temp dir without `<cwd>/.peaks/sops/`, the command does not throw and returns a registry response (which may be the global-only view, possibly empty).
- **Acceptance checks**: PRD 005 v2 AC6 — `peaks sop check` / `advance` / `gate enforce` / `registry` all default `--project` to cwd. AC9 — `--help` shows `[default: <cwd>]` on these commands. Both verified post-implementation.
- **Rollback plan**: revert the single-line CLI default change and the test. No schema, no data, no migration.
- **Commit boundary**: single commit per `main-branch-iteration` memory.

## Implementation evidence

- diff paths: `src/cli/commands/sop-commands.ts` (line 188, one-line default-value addition), `tests/unit/sop-commands.test.ts` (one new test block ~30 lines).
- test command + output: `npx vitest run tests/unit/sop-commands.test.ts` → 30 passed / 0 failed (29 pre-existing + 1 new "registry without --project defaults to cwd and merges the project layer when present (AC6)").
- full-suite result: `npx vitest run` → 1639 passed / 2 failed; the 2 fails are `statusline-settings-service.test.ts` `symlinkSync EPERM` on Windows, pre-existing on main and unrelated to this slice.
- build: `npm run build` → tsc clean, no type errors.
- code review: see `code-review.md` (recorded post-review).
- security review: see `security-review.md` (recorded post-review; one-line default-value change has no new attack surface).
- scope gate B8: `peaks scan diff-vs-scope --rid 2026-06-02-sop-global-reuse-ux-v2` → `violations: []`, `unclassified: []`, `patternsDeclared: true`.
- type gate B6: `peaks scan request-type-sanity --type feature` → `consistent: true` (1 source file + 1 test file changed).

## MCP usage

None. No external docs needed; `sop-commands.ts` and `sop-registry-service.ts` are local.

## Handoff

- to peaks-qa: `.peaks/2026-05-29-session-746113/qa/requests/2026-06-02-sop-global-reuse-ux-v2.md`
- to peaks-sc: `.peaks/2026-05-29-session-746113/sc/commit-boundaries/2026-06-02-sop-global-reuse-ux-v2.md`
- linked tech-doc: `.peaks/2026-05-29-session-746113/rd/tech-doc.md`

## Status

- created: 2026-06-01T16:17:16.072Z
- last update: 2026-06-02T00:30:00.000Z
- state: implemented (post-implementation: ready for QA handoff)
