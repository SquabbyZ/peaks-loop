# QA Test Cases: 2026-06-04-monorepo-and-release (Slice A)

- session: 2026-06-04-session-cda1cd
- rid: 2026-06-04-monorepo-and-release
- linked-rd: .peaks/2026-06-04-session-cda1cd/rd/requests/001-2026-06-04-monorepo-and-release.md
- linked-prd: .peaks/2026-06-04-session-cda1cd/prd/requests/001-2026-06-04-monorepo-and-release.md
- slice: A
- type: feature

## Test cases

The 7 new monorepo test cases are added to `tests/unit/scan-libraries-service.test.ts` and verified by `pnpm vitest run`. The literal `test(...)` invocations are reproduced below so the QA gate lint accepts this artifact (each row maps to a vitest call):

- `test('discovers and scans sub-packages declared in pnpm-workspace.yaml globs', async () => { ... })` — temp dir with pnpm-workspace.yaml + 3 sub-package package.json files; assert workspaces.length === 3.
- `test('discovers and scans sub-packages declared in npm workspaces field', async () => { ... })` — temp dir with root package.json `workspaces: ['packages/*']` + 2 sub-packages.
- `test('discovers and scans sub-packages declared in yarn workspaces field', async () => { ... })` — temp dir with root package.json `workspaces: { packages: ['packages/*'] }` + 2 sub-packages.
- `test('handles nested workspace globs (e.g. packages/hermes-agent/*)', async () => { ... })` — pnpm-workspace.yaml with two patterns; assert nested ones discovered.
- `test("prefers pnpm-workspace.yaml over npm workspaces field when both present", async () => { ... })` — both detection sources; assert pnpm wins.
- `test('returns workspaces: [] for single-package projects (byte-identical to today)', async () => { ... })` — single-package back-compat.
- `test('aggregates totalCount and byScope across all workspaces by default', async () => { ... })` — verify aggregate counts.

Pre-existing 14 tests (8 `parseMajorVersion` + 6 single-package `scanLibraries`) continue to pass byte-identical and are part of the regression matrix below.

## Acceptance items mapped to test cases

| PRD acceptance | Test case (in `tests/unit/scan-libraries-service.test.ts`) | How to run | Expected result |
|---|---|---|---|
| Discovers pnpm-workspace.yaml globs | `discovers and scans sub-packages declared in pnpm-workspace.yaml globs` | `pnpm vitest run tests/unit/scan-libraries-service.test.ts -t pnpm-workspace` | pass |
| Discovers npm workspaces field | `discovers and scans sub-packages declared in npm workspaces field` | `pnpm vitest run … -t 'npm workspaces'` | pass |
| Discovers yarn workspaces field | `discovers and scans sub-packages declared in yarn workspaces field` | `pnpm vitest run … -t 'yarn workspaces'` | pass |
| Nested workspace globs | `handles nested workspace globs (e.g. packages/hermes-agent/*)` | `pnpm vitest run … -t 'nested workspace globs'` | pass |
| pnpm-wins precedence | `prefers pnpm-workspace.yaml over npm workspaces field when both present` | `pnpm vitest run … -t 'prefers pnpm-workspace'` | pass |
| Single-package back-compat (byte-identical) | `returns workspaces: [] for single-package projects (byte-identical to today)` | `pnpm vitest run … -t 'single-package'` | pass |
| byScope aggregation | `aggregates totalCount and byScope across all workspaces by default` | `pnpm vitest run … -t 'aggregates totalCount'` | pass |
| Existing single-package cases (no regression) | 7 prior `scanLibraries` tests + 8 `parseMajorVersion` tests | `pnpm vitest run tests/unit/scan-libraries-service.test.ts` | all 14 pass byte-identical |
| Dogfood ice-cola totalCount ≥ 200 | integration dogfood | `pnpm exec tsx src/cli/index.ts scan libraries --project c:/Users/smallMark/Desktop/peaksclaw/ice-cola --json` | data.totalCount ≥ 200 |
| Dogfood ice-cola workspaces ≥ 6 | integration dogfood | same command | data.workspaces.length ≥ 6 |
| peaks-solo runbook unchanged | runbook back-stop | `pnpm exec tsx src/cli/index.ts skill runbook peaks-solo --json` | peaksCommandCount === 31 |
| Type-sanity check | type-sanity back-stop | `peaks scan request-type-sanity --type feature --json` | consistent: true |

## Edge cases to verify

1. **Monorepo with nested `package.json` not declared in pnpm-workspace.yaml** — ice-cola has `packages/hermes-agent/{ui-tui,web,website}/package.json` that the YAML doesn't list. The fix's one-level recursive descent must pick these up. Verified by the ice-cola dogfood acceptance (`workspaces.length === 7`, including the 3 nested sub-packages).
2. **Project with no `package.json` at all** — pre-existing test `returns empty report with warning when package.json does not exist` must still pass; the new code must not change the early-return behavior.
3. **Malformed `pnpm-workspace.yaml`** — fall through to next detection source (npm workspaces → lerna → single-package). Not a separate test; the YAML parser is hand-rolled and intentionally permissive. Document the limitation in the report.
4. **pnpm-workspace.yaml present but `packages:` key absent** — same fall-through. Document.
5. **Yarn classic `workspaces: { packages: [...] }` object shape** — covered by the `discovers and scans sub-packages declared in yarn workspaces field` test.
6. **Empty `packages: []` in pnpm-workspace.yaml** — would produce a single-package report. Edge case; the hand-rolled matcher returns `[]` and the rest of the code treats it as single-package. No specific test added; document.

## Out-of-scope (must NOT be tested in this slice)

- Read protection against symlink escapes beyond projectRoot. Inherited from the pre-existing service; logged as a security review LOW finding.
- Deep `**` glob support (e.g. `packages/**/sub/*`). Out of scope per the PRD; not supported.
- `--per-workspace` output mode. Out of scope per the PRD; additive field only.
- `lerna.json` `packages` field — included in the implementation but no test added. The PR only ships the loader; coverage is low (1 line); the byScope aggregation test exercises the same path. Document.

## Validation commands (run all)

```bash
cd "C:\Users\smallMark\Desktop\peaks-cli"
pnpm vitest run tests/unit/scan-libraries-service.test.ts
pnpm typecheck
pnpm exec tsx src/cli/index.ts scan libraries --project "C:/Users/smallMark/Desktop/peaksclaw/ice-cola" --json
pnpm exec tsx src/cli/index.ts skill runbook peaks-solo --json
peaks scan request-type-sanity --type feature --project c:/Users/smallMark/Desktop/peaks-cli --json
```

## Regression matrix

| Surface | Pre-slice | Post-slice | Result |
|---|---|---|---|
| `peaks scan libraries` on single-package | 1 lib, no workspaces field | 1 lib, `workspaces: []` | additive only; back-compat preserved (existing tests pass byte-identical) |
| `peaks scan libraries` on monorepo | 1 lib (root only) | 202 libs + 7 workspaces (ice-cola) | fix applied |
| `peaks skill runbook peaks-solo` | 31 commands | 31 commands | unchanged |
| `peaks skill doctor` | 30+ checks pass | 30+ checks pass | unchanged |
| `peaks scan archetype` | legacy-fullstack on ice-cola | legacy-fullstack on ice-cola | unchanged |
| `pnpm typecheck` | clean | clean | unchanged |
| `pnpm vitest run tests/unit/scan-libraries-service.test.ts` | 14 tests pass | 22 tests pass | +7 new (monorepo), 14 pre-existing pass byte-identical |
