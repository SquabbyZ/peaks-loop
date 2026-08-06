---
title: ESLint JS/TS Gate + OCR 1.8.x multi-language rebuild (slice PRD-002)
rid: 2026-08-06-eslint-jsts-gate-and-ocr-multilang-rebuild
session: 2026-08-06-session-cacde8
shipped: 4.0.16
status: sediment
---

# ESLint JS/TS Gate + OCR 1.8.x multi-language rebuild — slice sediment

## 1. User's "clear the entire 1.3.1 design" decision

The OCR 1.3.1 surface (`src/services/code-review/ocr-service.ts`,
`peaksConfig.ocr.llm`, `peaksConfig.ocr`, the `peaks code-review
{run,detect,config-template}-ocr` triad) was dead code: no caller in
`src/`, no `peaks-rd` Gate B3 dispatch ever reached it, and the
postinstall on Windows pulled a Go binary via HTTPS which the user
demoted to a peerDep in 2.8.2. The user explicitly chose to delete
the whole design rather than migrate it, because Tier 7 (v2.11.0,
commit `ddd41eb1`) had already moved Gate B3 to the ECC bridge. This
slice honors that decision: S2 deletes the entire 1.3.1 surface in
one commit so the baseline is locked before any new code lands.

## 2. OCR 1.8.9 per-platform optionalDependencies sandbox evidence

Sandbox run (2026-08-06, npm 10.9.4, Node 22.22.1):

```
$ npm install @alibaba-group/open-code-review@1.8.9
npm http fetch GET 200 https://registry.npmjs.org/@alibaba-group%2fopen-code-review 1324ms
npm http fetch GET 200 https://registry.npmjs.org/@alibaba-group%2focr-darwin-arm64
npm http fetch GET 200 https://registry.npmjs.org/@alibaba-group%2focr-darwin-x64
npm http fetch GET 200 https://registry.npmjs.org/@alibaba-group%2focr-linux-x64
npm http fetch GET 200 https://registry.npmjs.org/@alibaba-group%2focr-linux-arm64
npm http fetch GET 200 https://registry.npmjs.org/@alibaba-group%2focr-win32-x64
npm http fetch GET 200 https://registry.npmjs.org/@alibaba-group%2focr-win32-arm64
npm info run @alibaba-group/open-code-review@1.8.9 postinstall { code: 0, signal: null }
added 2 packages in 5s
```

No HTTPS request to `github.com` (which was the 2.0.3 pain point). The
1.8.9 `optionalDependencies` resolve from the npm registry only. The
embedded `scripts/install.js` picks the platform binary from the
already-fetched `node_modules`. With 1.8.x, the rationale for the
2.8.2 peerDep downgrade no longer applies; the user is therefore
right to ask for it back as a runtime dep (and the OCR adapter can
assume the binary is on disk).

## 3. Dependency strategy decisions

| Package | Classification | Rationale |
|---|---|---|
| `@alibaba-group/open-code-review@^1.8.9` | `dependencies` | 1.8.x per-platform optDep fixes the 2.0.3 postinstall HTTPS issue; no longer needs to be peer-only |
| `eslint` + `@typescript-eslint/{parser,eslint-plugin}` + `eslint-plugin-import` | NOT in `devDependencies`; loaded via `npx --package` | avoid peaks-loop devDep bloat; matches `config/eslint/.peaks-rules.cjs` G-lint-1 dynamic-loading contract; allows the L3 framework plugins to be opted in per project |

ESLint pin map (recorded in `src/services/lint/eslint-runner.ts`
`ESLINT_PACKAGE_PINS`):

| Package | Pin |
|---|---|
| `eslint` | `10.8.0` |
| `@typescript-eslint/parser` | `8.66.0` |
| `@typescript-eslint/eslint-plugin` | `8.66.0` |
| `eslint-plugin-import` | `2.32.0` |

## 4. Lessons for the next time someone integrates a sibling tool

1. **Clear the dead design FIRST.** The S2 clear-zero commit is the
   single most important commit in the slice. Without it, the
   S1/S3/S4 work would sit on top of 463 lines of unused code and
   the user-visible CLI would have two parallel `code-review`
   surfaces. Locking the baseline before any new code is non-optional.
2. **Pinned toolchain > devDeps for verifier-like wrappers.** The
   ESLint runner uses `npx --package <pkg>@<pin>` so the package
   version is auditable in the source file (one read, not a
   pnpm-lock search). This also keeps peaks-loop's devDeps from
   growing when the toolchain is project-local.
3. **Read-only verifiers must refuse --fix in the wrapper itself.**
   `runEslint` throws synchronously when `fix: true` is passed;
   this keeps the G-lint-2 red line enforceable at the type-system
   seam, not via a hard-to-test docs note.
4. **Detect must return a 5-state envelope even when the only
   failure mode is "tool missing".** peaks-rd's Gate B3/B5 needs a
   uniform verdict shape; the OCR 1.8.x detect reuses the ECC
   detect contract so the same aggregation code path works for
   both reviewer families.
5. **`npx --package` resolution requires an explicit build approval
   on pnpm 10+.** Without `onlyBuiltDependencies` in
   `pnpm-workspace.yaml`, the postinstall step is skipped and the
   package is registered as present-but-broken (no `bin/ocr.js`
   runtime). Document this for the next pnpm 11+ bump.
6. **Always rerun previously-timed-out test files in isolation.**
   The first full-suite run after S2 reported 3 timeout failures in
   auto-compact / statusline tests; each passed in isolation within
   5-21s. Treat 30s-timeout failures as contention, not regression.

## 5. Files added / deleted in this slice

Deleted (S2):
- `src/services/code-review/ocr-service.ts` (463 lines)
- `skills/bee/peaks-rd/references/ocr-integration.md` (229 lines)

Added:
- `src/services/lint/eslint-runner.ts` (S1)
- `src/services/lint/detect-eslint.ts` (S1)
- `src/services/lint/ocr-multilang-adapter.ts` (S3)
- `src/services/lint/detect-ocr-18.ts` (S3)
- `src/cli/commands/lint-commands.ts` (S1)
- `skills/bee/peaks-rd/references/jsts-eslint-gate.md` (S1)
- `skills/bee/peaks-rd/references/ocr-multilang-1.8.md` (S3)
- `tests/unit/services/lint/eslint-runner.test.ts` (S1)
- `tests/unit/services/lint/ocr-multilang-adapter.test.ts` (S3)
- `tests/unit/cli/commands/lint-commands.test.ts` (S1)

## 6. Commit SHAs (4 commits, in order)

- S2: `8a340fb7` — `refactor(code-review): clear 1.3.1 ocr surface (slice PRD-002/S2)`
- S1: `432760cf` — `feat(lint): ship peaks code lint CLI + ESLint runner + Gate B5 expansion (slice PRD-002/S1)`
- S3: `ff5019e4` — `feat(code-review): ship OCR 1.8.x multi-language reviewer adapter (slice PRD-002/S3)`
- S4: (recorded in this file at the time of `peaks request transition`)

## 7. AC results

- AC-1 ESLint CLI — delivered via `peaks code lint` (S1).
- AC-2 OCR clear-zero — verified via `git grep` (post-S2: only the
  explicitly-kept `detect-ocr-18` / `run-ocr-18` names remain).
- AC-3 OCR 1.8.9 multilang — adapter at `ocr-multilang-adapter.ts`,
  detect at `detect-ocr-18.ts`.
- AC-4 Gate routing — Gate B5 paragraph in `skills/bee/peaks-rd/SKILL.md`
  and both new skill references document the JS/TS-ESLint vs
  multilang-OCR split.
- AC-5 Tests — `pnpm test:unit` passes (timeout-only flakes rerun
  green in isolation).
- AC-6 Docs — both new skill references ship.
