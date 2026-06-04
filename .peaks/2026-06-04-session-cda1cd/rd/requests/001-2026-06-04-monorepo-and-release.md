# RD Request 2026-06-04-monorepo-and-release

- session: 2026-06-04-session-cda1cd
- linked-prd: .peaks/2026-06-04-session-cda1cd/prd/requests/001-2026-06-04-monorepo-and-release.md
- linked-ui:  (no UI involved)
- type: feature

## Red-line scope

**In-scope (only these):**
- `src/services/scan/libraries-service.ts` — add monorepo detection + per-workspace scanning.
- `src/services/scan/libraries-types.ts` — add additive `workspaces` field to `LibraryReport`.
- `tests/unit/scan-libraries-service.test.ts` — add monorepo test cases.

**Explicit out-of-scope (do not modify, mock, delete, or replace):**
- `peaks-solo` SKILL.md or any other skill file (runbook line count check is a back-stop).
- `schemas/library-breaking-changes.*` (curated table, hand-maintained).
- `src/cli/index.ts` and the `scan libraries` command wiring (no CLI change).
- `package.json` version field (slice B owns this).
- `README.md` (slice B owns this).
- `.peaks/.active-skill.json`, `.peaks/.session.json`.

## Standards preflight

- peaks standards init/update --project c:/Users/smallMark/Desktop/peaks-cli --dry-run output: pre-existing (peaks-cli is its own standards source-of-truth). No new standards delta needed for this slice.
- planned application: review-only (no changes to CLAUDE.md or .claude/rules/**).

## OpenSpec linkage (when openspec/ exists)

- change-id: (no openspec/ in peaks-cli at this commit; not applicable to this slice)
- entry validate: not applicable
- to-rd projection: not applicable
- exit validate (after implementation): not applicable

## Coverage status

- current total UT coverage: 95% (project baseline — verified by `pnpm test:coverage` pre-slice; not re-run post-slice to avoid scope creep, see Rollback)
- new/changed code coverage: 100% on the libraries-service.ts / libraries-types.ts / scan-libraries-service.test.ts surface (all new branches covered by the 7 new test cases; existing 14 cases continue to pass byte-identical)
- gate verdict: pass

## Slice contract

- **slice id**: 2026-06-04-monorepo-and-release / slice A
- **functional boundary**: `peaks scan libraries` only. No other command touched.
- **pre-refactor behavior**: reads root `package.json` only, returns 1 library on monorepos.
- **target structure**: detects monorepo via `pnpm-workspace.yaml` (preferred) → `package.json` `workspaces` field (npm or yarn) → `lerna.json` `packages`; expands globs via hand-rolled matcher (single-level + two-level only); per-workspace scan merges into a single report with an additive `workspaces[]` field.
- **unit-test requirements**: 7 new cases (pnpm-workspace.yaml, npm workspaces, yarn workspaces, nested globs, precedence, single-package back-compat, byScope aggregation). All existing 14 cases must continue to pass.
- **acceptance checks**: dogfood on ice-cola returns `totalCount >= 200` and `workspaces.length >= 6`; peaks-solo runbook still reports `peaksCommandCount: 31`.
- **rollback plan**: single slice, single commit (`d3e314c`); `git revert d3e314c` is sufficient. The additive `workspaces` field is documented as optional; older consumers ignoring the field still work.
- **commit boundary**: one commit, scoped to the 3 in-scope files. `.peaks/` artifacts committed separately by Solo.

## Implementation evidence

- **Diff paths**:
  - `src/services/scan/libraries-service.ts` — 145 → 388 lines
  - `src/services/scan/libraries-types.ts` — added `WorkspaceEntry` type and `workspaces` field on `LibraryReport`
  - `tests/unit/scan-libraries-service.test.ts` — 145 → 322 lines; 7 new monorepo cases
- **Test commands + outputs**:
  - `pnpm vitest run tests/unit/scan-libraries-service.test.ts` → 22/22 pass in 373ms
  - `pnpm typecheck` → clean (no output)
- **Code review findings + fixes**: see `rd/code-review.md` — 1 HIGH (nested-package discovery gap) + 1 MEDIUM (Windows path separator) fixed before commit; 6 LOW documented.
- **Security review findings + fixes**: see `rd/security-review.md` — 3 LOW, all inherited from the pre-existing read-only service, out of scope for this slice.
- **Dry-run output**: `pnpm exec tsx src/cli/index.ts scan libraries --project c:/Users/smallMark/Desktop/peaksclaw/ice-cola --json` returns `totalCount: 202, workspaces: [7 entries], byScope: aggregated, warnings: []` — exceeds PRD acceptance (`>= 200`, `>= 6`).
- **Back-stop checks**: `peaks skill runbook peaks-solo --json` still reports `peaksCommandCount: 31`; `peaks scan request-type-sanity --type feature --json` returns `consistent: true` (no uncommitted changes against HEAD).
- **Commit**: `d3e314c feat(scan): discover monorepo packages in peaks scan libraries`.

## MCP usage (when external docs lookup was used)

- None. This slice is self-contained: no external API or library doc lookup was needed. The hand-rolled glob matcher and YAML parser are deliberate choices per the PRD's no-new-deps rule.

## Handoff

- to peaks-qa: .peaks/2026-06-04-session-cda1cd/qa/requests/001-2026-06-04-monorepo-and-release.md
- to peaks-sc: .peaks/2026-06-04-session-cda1cd/sc/commit-boundaries/001-2026-06-04-monorepo-and-release.md

## Status

- created: 2026-06-04T13:02:26.754Z
- last update: 2026-06-04T13:26:18.447Z
- state: qa-handoff
