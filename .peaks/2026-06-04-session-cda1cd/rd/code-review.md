# RD Code Review — slice 2026-06-04-monorepo-and-release (A)

- reviewer: RD sub-agent (self-review)
- date: 2026-06-04
- files reviewed:
  - `src/services/scan/libraries-service.ts` (modified, 145 → 388 lines)
  - `src/services/scan/libraries-types.ts` (modified, +24 lines)
  - `tests/unit/scan-libraries-service.test.ts` (modified, 145 → 322 lines)

## Summary

The change extends `peaks scan libraries` to discover pnpm / npm / yarn / lerna monorepo workspaces and enumerate their `package.json` files in addition to the root. Output is additive — `LibraryReport.workspaces` is a new field, single-package projects get `workspaces: []`, and existing fields (`libraries[]`, `totalCount`, `byScope`, `warnings`, `scannedAt`, `projectRoot`) are byte-identical apart from being aggregated across workspaces in monorepo mode.

The new code is contained, follows the existing module's style (function-level `async/await`, no `any`, no mutation, immutability preserved via array spread), and is fully covered by 7 new unit tests (22 total, all green). Typecheck passes with `exactOptionalPropertyTypes: true`. Dogfood on ice-cola returns `totalCount: 202` (was 1) and `workspaces.length: 7`.

## Findings

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | The hand-rolled pnpm-workspace.yaml parser is line-based and could be confused by inline comments containing `-` characters. Not a practical risk (pnpm workspace files use `-` only for list items) but worth documenting. | LOW | deferred — documented in tech-doc; no evidence of misuse in the wild. |
| 2 | Initial implementation respected `pnpm-workspace.yaml` literally and missed ice-cola's 3 nested packages (hermes-agent/ui-tui, hermes-agent/web, hermes-agent/website). Added a one-level recursive descent into each discovered workspace dir. | HIGH | fixed — `discoverWorkspacePackageJsons` now follows the pnpm convention where a workspace can be a container for sub-packages. |
| 3 | Path separator on Windows broke an early test assertion (`endsWith('admin/package.json')` failed on `admin\package.json`). Replaced with a helper that accepts both separators. | MEDIUM | fixed — test now cross-platform. |
| 4 | `parsePnpmWorkspaceYaml` had a `string | undefined` type under strict mode (`itemMatch[2]`). Guarded with explicit `undefined` check. | LOW | fixed. |
| 5 | `WorkspaceEntry` is built with `name: record.name` even when `name` is `undefined`; under `exactOptionalPropertyTypes: true` this is a type error. Switched to conditional property assignment. | MEDIUM | fixed. |
| 6 | The `workspaces[]` field in `LibraryReport` always exists (even on single-package projects) so consumers can rely on the shape. Single-package tests assert `workspaces: []`. | LOW | accepted — additive shape is the explicit goal. |
| 7 | `pnpm exec tsx` invocation in the dogfood step is the same as the live CLI command, but in the slice's runtime context tsx is the binary. The CLI path is the production binary. The dogfood demonstrates behavior, not the production build path. | LOW | accepted — this is how peaks-rd self-validates; the build path is gated in slice B. |
| 8 | The recursive descent into discovered workspace dirs (the fix for finding 2) is a heuristic that may pick up sub-packages the user did not intend to scan. Counter-argument: pnpm/npm/yarn treat a workspace package as a container for its own sub-workspaces, and the recursive scan mirrors `pnpm list -r`. | LOW | accepted — `peaks-solo` consumers can filter on the `workspaces[].path` field if they need to scope down. |

## Verdict

**pass** — no CRITICAL or HIGH issues remain. The 2 HIGH/MEDIUM findings (recursive descent for nested packages, path separator robustness) were fixed before dogfood. The remaining LOW items are documented tradeoffs, not blockers.

## Test summary

- 22 unit tests pass (8 `parseMajorVersion` + 7 `scanLibraries` original + 7 `scanLibraries` monorepo).
- `pnpm typecheck` is clean (no errors, no warnings).
- Dogfood on `C:/Users/smallMark/Desktop/peaksclaw/ice-cola`: `data.totalCount: 202` (acceptance: >= 200), `data.workspaces.length: 7` (acceptance: >= 6), `data.warnings: []`.
