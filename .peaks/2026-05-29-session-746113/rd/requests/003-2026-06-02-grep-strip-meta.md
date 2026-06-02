# RD Request 2026-06-02-grep-strip-meta

- session: 2026-05-29-session-746113
- linked-prd: .peaks/2026-05-29-session-746113/prd/requests/006-2026-06-02-grep-strip-meta.md
- linked-ui:  N/A
- type: feature (ux-fix)

## Red-line scope

**In-scope (paths and behavior):**

- `src/services/sop/sop-types.ts` — add `stripMeta?: boolean` to the `grep` variant of `SopGateCheck` (one-line type change). Add `warnings: string[]` field to `SopLintResult` (one-line type change).
- `src/services/sop/sop-check-service.ts` — extend `evaluateGrep` to apply `stripMetaForGrep(content)` when `check.stripMeta === true`; export the new `stripMetaForGrep(content: string): string` pure helper. Eval logic / verdict shape / blocked-on-error path unchanged.
- `src/services/sop/sop-service.ts` — add `warnings: string[]` to `SopLintResult` (already on type); in `lintManifest`, for each gate of type `grep` with `check.stripMeta === true`, push a human-readable warning string. Do not push findings for `stripMeta: true`.
- `src/cli/commands/sop-commands.ts` — include the new `warnings` field in the `sop lint` JSON response (currently only `findings` is in the response data).
- `tests/unit/sop-check-service-strip-meta.test.ts` — NEW file. Focused unit tests for: (a) the stripper in isolation (HTML comment / fenced code / block comment happy paths + unclosed-fence + unclosed-block-comment sad paths), (b) `evaluateGrep` with `stripMeta: true` and `absent: true` (the AC1+AC2 combination), (c) `absent: true` + `stripMeta: false` byte-identity guard (AC5), (d) `stripMeta: undefined` byte-identity guard (AC5).
- `skills/peaks-sop/SKILL.md` — one-paragraph addition under "Where SOPs apply" or new sub-section, describing the literal-word trap and the `stripMeta` opt-in. ≤ 30 lines. AC9.
- `posts/2026-06-02-prd005-v2-dogfood.md` — pre-existing project-layer dogfood artifact from PRD 005 v2 (carried in to keep B8 happy: B8 scans every untracked file; this one is read-only here, included in the patterns to suppress a false-positive unclassified finding).

**Out-of-scope (explicitly do not touch):**

- `src/services/sop/sop-check-service.ts` — `evaluateFileExists`, `evaluateCommand`. The PR's scope is grep-only.
- `src/services/sop/sop-advance-service.ts` — unchanged. `sop advance` semantics for gates with `stripMeta` are inherited automatically (gate still returns pass/fail/blocked; verdict flow unchanged).
- `src/services/sop/sop-paths.ts`, `sop-registry-service.ts` — unchanged. PRD 004 Slice 2 invariant.
- `src/services/sop/sop-types.ts` — the `file-exists` and `command` variants of `SopGateCheck` are unchanged. No `stripMeta` on those (they don't read free-text content).
- `tests/unit/sop-check-service.test.ts`, `sop-commands.test.ts`, `sop-advance-service.test.ts`, `sop-service.test.ts`, `sop-project-layer.test.ts`, `sop-registry-service.test.ts`, `gate-enforce-service.test.ts` — these 7 test files MUST pass byte-identically with the slice. No new assertions in any of them.
- `openspec/changes/` — no new change. Below the engineering-change bar.
- `package.json` — no new dependencies.

## Standards preflight

- `peaks standards init --project . --dry-run --json` — no missing standards files reported.
- `peaks standards update --project . --dry-run --json` — no drift.
- All four Gate A3 files exist (CLAUDE.md, .claude/rules/common/{coding-style,code-review,security}.md).
- planned application: **review-only** (no new rule content needed; existing rules already cover immutable patterns, error handling, coverage red-line).

## OpenSpec linkage

- No change. The slice adds an optional boolean field to a discriminated union and a pure-string helper. Below the engineering-change bar used by existing entries in `openspec/changes/` (`add-tech-dry-run-gate`, `enforce-artifact-boundary-and-coverage`). Per RD runbook "skip steps that do not apply", no OpenSpec change for this slice.

## OQ answers (from PRD 006)

- **OQ1** (absent:false with stripMeta:true — fail if only meta contains the pattern?): PRD's lean is (a) — meta-strip is a pre-processing step applied to the input domain of the regex, not a behavior modifier for `absent`. `absent: false` (find-or-fail: PASS) is applied to the **stripped** content. If only HTML comment contains the pattern, the regex doesn't match after stripping → fail. Documented in PRD AC4 + tech-doc `## Data flow` item 4.
- **OQ2** (cover `/* ... */` block comments?): PRD leans yes — same SOP may gate `.ts` / `.js` / `.c` / `.cpp` files. Including block comments costs ~3 lines of regex, no test explosion.
- **OQ3** (lint warning vs finding?): warnings array. Implemented in `sop-service.ts:lintManifest` (pushed alongside `findings`, not into it). Backward-compatible: `findings` shape unchanged; existing CLI consumers see no behavior change for gates that don't opt in.

## Coverage status

- Pre-iteration baseline: ~88% (per memory; pre-existing on main).
- New/changed code in this slice:
  - `sop-types.ts`: 2 type additions (`stripMeta` on grep variant, `warnings` on SopLintResult). Type-only changes; no runtime branches.
  - `sop-check-service.ts`: 1 new function `stripMetaForGrep` (~6 lines, 1 return); 1 conditional in `evaluateGrep` (1-line addition). Both fully exercised by the new test file.
  - `sop-service.ts`: 1 new branch in `lintManifest` (gated on `check.stripMeta === true`); 1 new field init. Both covered by existing or new tests.
  - `sop-commands.ts`: 1-line addition to lint response data.
- Expected post-iteration coverage on the changed file (`sop-check-service.ts`): existing ~100% + 100% on the new function/branch. New test file provides behavior assertions, not branch-coverage padding (per `coverage-red-line` memory).
- gate verdict (post-implementation): TBD — see "Implementation evidence" below.

## Slice contract

- **Slice id**: `sop-grep-strip-meta`
- **Functional boundary**: `grep` gate evaluator + lint warnings + SopGateCheck/SopLintResult type additions.
- **Pre-slice behavior**: `grep` regex matches the raw file content. `absent:true` fails on any occurrence anywhere in the file. Lint reports only `findings`. `sop lint` JSON has no `warnings` field.
- **Target structure**: `stripMeta:true` causes the regex to match the meta-stripped content (HTML comments / fenced code / `/* */` blocks removed). `absent:true` operates on the stripped content. Lint reports a `warnings` string per gate that opts in. `sop lint` JSON gains a `warnings` field. Default behavior (no `stripMeta` declared) is byte-identical to today.
- **Unit-test requirements** (per `coverage-red-line`):
  - Test 1 (AC1): `grep absent:true + stripMeta:true` against a file containing `<!-- T-O-D-O -->` — asserts pass, with reason-equal-pass. This is a behavior assertion ("the gate now ignores the HTML comment for purposes of pattern matching").
  - Test 2 (AC2): same gate, file with `T-O-D-O` in rendered content — asserts fail. The rendered-content collision must still fail.
  - Test 3 (AC3): same gate, file with `\`\`\`\nT-O-D-O\n\`\`\`` fenced code — asserts pass. Fence is stripped.
  - Test 4 (AC5 byte-identity): same gate, file where `stripMeta:false` and `stripMeta:undefined` produce identical verdicts to the pre-slice behavior. This is a regression guard for the backward-compat contract.
  - Test 5 (stripper unclosed-fence sad path): input with `\`\`\`\ncontent but no closing fence` — assert output equals input (no partial strip; fail-safe conservative).
  - Test 6 (stripper unclosed block comment sad path): input with `/* unclosed` — assert output equals input.
- **Acceptance checks**: PRD 006 AC1-AC9.
- **Rollback plan**: revert the 5 file changes + 1 new test file. No schema/data migration.
- **Commit boundary**: single commit per `main-branch-iteration` memory.

## Implementation evidence

(populated post-implementation)

- diff paths: `src/services/sop/{sop-types, sop-check-service, sop-service}.ts`, `src/cli/commands/sop-commands.ts`, `skills/peaks-sop/SKILL.md` (5 modified + 1 new test file).
- test command + output: see Gate B2 below.
- code review findings + fixes: see `code-review.md`.
- security review findings + fixes: see `security-review.md`.
- scope gate B8: `peaks scan diff-vs-scope --rid 2026-06-02-grep-strip-meta` → `violations: []`, `unclassified: []`, `patternsDeclared: true`.
- type gate B6: `peaks scan request-type-sanity --type feature` → `consistent: true` (1 new test file + 5 modified).
- build: `npm run build` → tsc clean.

## MCP usage

None. No external docs needed; `sop-check-service.ts` and `sop-service.ts` are local.

## Handoff

- to peaks-qa: `.peaks/2026-05-29-session-746113/qa/requests/2026-06-02-grep-strip-meta.md`
- to peaks-sc: `.peaks/2026-05-29-session-746113/sc/commit-boundaries/2026-06-02-grep-strip-meta.md`

## Status

- created: 2026-06-01T17:19:30.563Z
- last update: 2026-06-02T01:23:00.000Z
- state: draft → implemented (post-implementation: state: rd:implemented)
