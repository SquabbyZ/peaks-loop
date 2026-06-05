# QA Request 2026-06-04-monorepo-and-release (Slice A)

- session: 2026-06-04-session-cda1cd
- linked-prd: .peaks/2026-06-04-session-cda1cd/prd/requests/001-2026-06-04-monorepo-and-release.md
- linked-rd:  .peaks/2026-06-04-session-cda1cd/rd/requests/001-2026-06-04-monorepo-and-release.md
- linked-ui:  (no UI involved)
- type: feature

## Red-line boundary check

- in-scope changes seen in the diff (match PRD + RD scope)
  - `src/services/scan/libraries-service.ts` — added monorepo detection
    (pnpm-workspace.yaml / package.json `workspaces` / lerna.json) +
    per-workspace scanning + hand-rolled glob matcher + hand-rolled
    YAML parser. The single-package code path is preserved byte-for-byte
    apart from the additive `workspaces: []` field on the return.
  - `src/services/scan/libraries-types.ts` — added `WorkspaceEntry` type
    and the additive `workspaces` field on `LibraryReport`. Field is
    always present (empty array for single-package projects) so
    consumers can rely on the shape.
  - `tests/unit/scan-libraries-service.test.ts` — 7 new monorepo unit
    cases; all 14 pre-existing cases continue to pass byte-identical.
- out-of-scope changes flagged (any extra file, route, mock, fixture, behavior)
  - None. The diff is exactly 3 files (per the slice commit's `--stat`).
  - No CLI wiring change (per the PRD non-goal "no new CLI commands" and
    the RD's red-line scope).
  - No skill file touched.
  - No version bump in `package.json` (slice B owns that).
  - No `README.md` change (slice B owns that).
  - No `.peaks/.active-skill.json` or `.peaks/.session.json` mutation.
- verdict: **clean**

## OpenSpec exit gate (when openspec/ exists)

- change-id: not applicable
- There is no `openspec/` directory in peaks-cli at this commit, so the
  OpenSpec validate / archive flow is N/A.
- verdict: **n/a**

## Acceptance checks

Per PRD `## Acceptance criteria` (slice A items only — slice B and slice C
are out of QA scope for this artifact per the PRD's sub-slice plan):

- Slice A acceptance #1: `peaks scan libraries --project ice-cola --json`
  returns `totalCount >= 200`.
  - method: `pnpm exec tsx src/cli/index.ts scan libraries --project
    "C:/Users/smallMark/Desktop/peaksclaw/ice-cola" --json`
  - result: **pass** — `data.totalCount === 202`
  - evidence: `.peaks/2026-06-04-session-cda1cd/qa/test-reports/2026-06-04-monorepo-and-release.md` § Dogfood on ice-cola
- Slice A acceptance #2: report includes a new `workspaces` field listing
  each discovered `package.json` path and its library count.
  - method: same dogfood command + unit test
    `discovers and scans sub-packages declared in pnpm-workspace.yaml globs`
  - result: **pass** — 7 entries in `data.workspaces`, each with
    `path` and `count` (plus optional `name` / `version`); unit test
    green
  - evidence: same test report; this artifact's Regression matrix
- Slice A acceptance #3: on a single-package fixture, the report shape is
  byte-identical (or `workspaces: []`).
  - method: unit test `returns workspaces: [] for single-package projects
    (byte-identical to today)` + the 14 pre-existing tests
  - result: **pass** — vitest 22/22 green; the 14 pre-slice tests pass
    byte-identical
  - evidence: this artifact's § Mandatory validation gates (unit tests)
- Slice A acceptance #4: unit tests cover pnpm-workspace.yaml glob, npm
  workspaces field, yarn workspaces field, nested globs.
  - method: `pnpm vitest run tests/unit/scan-libraries-service.test.ts`
  - result: **pass** — 22/22 green; the 7 new cases cover all four
    required shapes plus precedence, single-package back-compat, and
    byScope aggregation
  - evidence: same as above

## Mandatory validation gates

- **unit tests**: `pnpm vitest run tests/unit/scan-libraries-service.test.ts`
  → 22/22 pass in 374ms (8 `parseMajorVersion` + 7 original
  `scanLibraries` single-package + 7 new monorepo). **Coverage delta:**
  the 7 new monorepo branches are 100% covered by the new unit cases
  (RD tech-doc § Coverage status; verified by vitest's per-file report).
- **API validation (when applicable)**: not applicable — the change is to
  a CLI command's internal logic, not to an API contract. The CLI's
  JSON envelope gains the additive `workspaces` field per the PRD's
  non-goal "no breaking changes to the scanLibraries JSON envelope
  shape".
- **browser E2E (when frontend)**: **n/a** — peaks-cli is a CLI tool;
  no UI changes (per PRD § Frontend delta).
- **browser-error feedback loop**: **n/a** — no frontend in scope.
- **security check**: `qa/security-findings.md` written. Tools used:
  manual diff review of `src/services/scan/libraries-service.ts` and
  `src/services/scan/libraries-types.ts` against the security checklist
  in `peaks-qa/SKILL.md`. Result: 0 CRITICAL / 0 HIGH / 0 MEDIUM / 3 LOW
  (all inherited from the pre-existing read-only service; documented
  and out of scope per RD security-review).
- **performance check**: `qa/performance-findings.md` written. Tool used:
  `time` on the dogfood command. Result: 1.447s real on 7 workspaces /
  202 libraries. Threshold: 5s. Pass by 3.46x margin.
- **validation report path**: this file
  (`qa/requests/001-2026-06-04-monorepo-and-release.md`) + the three
  sibling artifacts
  (`qa/test-reports/2026-06-04-monorepo-and-release.md`,
  `qa/security-findings.md`, `qa/performance-findings.md`).

## Regression matrix

| Surface | Pre-slice | Post-slice | Result |
|---|---|---|---|
| `peaks scan libraries` on single-package | 1 lib, no `workspaces` field | 1 lib, `workspaces: []` | additive only; back-compat preserved (14 pre-slice unit tests pass byte-identical) |
| `peaks scan libraries` on monorepo (ice-cola) | 1 lib (root only) | 202 libs + 7 workspaces | fix applied; matches PRD acceptance |
| `peaks skill runbook peaks-solo` | 31 commands | 31 commands | unchanged |
| `peaks scan request-type-sanity` (type=feature) | consistent: true | consistent: true | unchanged |
| `pnpm typecheck` | clean | clean | unchanged |
| `pnpm vitest run tests/unit/scan-libraries-service.test.ts` | 14 tests | 22 tests | +7 new (monorepo), 14 pre-existing pass byte-identical |
| `pnpm vitest run` (full suite) | 7 pre-existing Windows failures in `config-safety-canonical-root.test.ts` (5) + `statusline-settings-service.test.ts` (2) | same 7 pre-existing failures; 0 new | confirmed via parent-commit re-run of the two failing files (git checkout 92ef8c3 -- tests/unit/{config-safety-canonical-root,statusline-settings-service}.test.ts) |
| `pnpm exec tsx scan libraries --project ice-cola` performance | N/A (single-package code path) | 1.447s real on 7 workspaces, 202 libraries | under 5s threshold by 3.46x |
| No new external network calls, no new dependencies, no new top-level imports outside existing set | n/a | confirmed | see `qa/security-findings.md` |

## Browser evidence

- n/a — peaks-cli is a CLI tool. There is no frontend in this slice; the
  PRD § Frontend delta explicitly says "Not applicable". No browser
  screenshots, console logs, or network traces are required for this
  artifact.

## Verdict

- overall: **pass**

## Status

- created: 2026-06-04T13:02:33.272Z
- last update: 2026-06-04T21:39:00.000Z
- state: verdict-issued
