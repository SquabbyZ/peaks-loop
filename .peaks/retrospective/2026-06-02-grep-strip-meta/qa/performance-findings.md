# Performance Findings — 2026-06-02-grep-strip-meta

- reviewer: QA
- review date: 2026-06-02
- verdict: **PASS** — no perf regression; no new perf-sensitive code path

## Scope reviewed

- 1 type field addition (`stripMeta?: boolean`)
- 1 pure-string helper (`stripMetaForGrep`, O(n))
- 1 conditional in `evaluateGrep` (one-line addition to apply the stripper before `regex.test`)
- 1 new field in `SopLintResult.warnings` (collected at most once per gate)
- 1 SKILL.md doc addition (no runtime impact)

## Why this slice is performance-insensitive

- `stripMetaForGrep` is O(n): three regex replacements, each bounded by literal end markers or a closing-fence line, all using lazy `*?` quantifiers. Unclosed fences and unclosed block comments fall through un-stripped (no partial-strip work).
- The new `warnings: string[]` field is populated at most once per gate (a constant-time append per `stripMeta:true` gate). The field is initialized to `[]` in both return paths of `lintSop`, so consumers see a stable shape.
- The CLI does not change: `sop lint` already passes the full `result` object to `ok(...)`; `warnings` flows through automatically.
- No new dependencies. No new modules. No new top-level imports.

## Build / size baseline

- `npm run build` → tsc clean, exit 0.
- `dist/` total size: 3.0 MB (unchanged from prior baseline — same dist contents modulo the patch).
- `dist/src/services/sop/sop-check-service.js` size: 8348 bytes (unchanged, within rounding error of the pre-slice 8348-byte baseline).
- `git diff --stat HEAD --` for the changed source files: 4 files modified (sop-types.ts, sop-check-service.ts, sop-service.ts, sop-commands.ts + 1 SKILL.md + 1 new test file). All within the documented "small" slice scope.

## Test suite runtime

- Focused suite (8 SOP-related files): 122/126 pass; 4 fails are pre-existing project-layer state residue from PRD 005 v2 dogfood (wechat-post-publish SOP) and unrelated to this slice (verified by `git stash` reproducing the same 4 fails on the prior commit).
- Full project suite: 6 fails total (4 sop-commands + 2 statusline-settings-service.test.ts Windows symlink EPERM); all 6 are pre-existing on `main` and unrelated to this slice.
- The 16 new tests in `sop-check-service-strip-meta.test.ts` add ~15 ms to the focused suite runtime.

## Hot path analysis

- No changes to `evaluateFileExists`, `evaluateCommand`, or any other evaluator branch.
- The new `stripMeta` field is read from the manifest (already JSON-parsed) and compared with `=== true`; the stripper runs only when explicitly opted in.
- For SOPs that don't opt in (the common case), `evaluateGrep` follows its pre-slice path exactly — no new branches executed, no new allocations.

## Verdict

PASS. No measurable performance impact. No bundle-size regression. No new dependency. The slice is the minimum-effort implementation of PRD 006.
