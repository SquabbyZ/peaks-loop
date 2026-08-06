---
name: pilot-no-duplicate-imports-findings-2026-08-07
description: PRD-002b 1-slice pilot revealed no-duplicate-imports is NOT auto-fixable in ESLint 8.57.1 + 28 real violations across 25 src/ files + 4 tests/ files detected via direct ESLint run with ts-eslint parser
metadata:
  type: slice-pilot-findings
  scope: project-level
  effective: 2026-08-07
---

# PRD-002b 1-slice pilot — `no-duplicate-imports` findings (2026-08-07)

## TL;DR

The first PRD-002b pilot slice (`no-duplicate-imports`) **stopped without applying any auto-fix** because:

1. **The plugin-prefixed ruleId (`@typescript-eslint/no-duplicate-imports`) used in `config/eslint/.peaks-rules.cjs` is NOT defined in `@typescript-eslint/eslint-plugin@8.66.0`** — all 820 baseline entries of that ruleId are `Definition for rule ... was not found` config-coverage errors, not real duplicate-import detections.
2. **The ESLint built-in `no-duplicate-imports` rule is NOT auto-fixable** in eslint 8.57.1 (no `fixable` field in rule meta). ESLint `--fix` reports the violations but never rewrites any source file.
3. **Real violation count** (via direct ESLint run with `@typescript-eslint/parser` + `--rule '{"no-duplicate-imports": "warn"}'` against `src/` + `tests/` + `packages/*/src/`): **32 violations across 29 files** (28 src/ + 4 tests/ + 0 packages/).

## Pre-flight gate verification

- `git status` clean except for 2 prior-cycle sediment files (`.peaks/lint/baseline.json` + `.peaks/memory/lint-redline-summary.md`) — untouched by this slice
- `git log --oneline -10` → HEAD = `fa1a1f32 chore(memory): sediment task1+task2 ship closure`
- `peaks -v` → 4.0.16 ✓
- `pnpm build` → exit 0 (verified)
- Read `.peaks/memory/2026-08-06-incremental-first-no-touch-stockcode-rule.md` — Scenario B ack still in effect
- Read `.peaks/memory/2026-08-06-task1-task2-ship-closure.md` — L3 cp-to-global sync pattern noted

## Pre-fix state

| Source | no-duplicate-imports violations | Files affected |
| --- | --- | --- |
| `src/` | 28 | 25 |
| `tests/` | 4 | 4 |
| `packages/*/src/` | 0 | 0 |
| **Total real** | **32** | **29** |

> Note: baseline.json's 820 entries of `@typescript-eslint/no-duplicate-imports` are **all** `Definition for rule '@typescript-eslint/no-duplicate-imports' was not found.` — they are config-coverage errors, not real duplicate-import detections. They cannot be auto-fixed by definition (the rule must first be defined in the plugin).

## Why auto-fix didn't work

Direct evidence: `node_modules/eslint/lib/rules/no-duplicate-imports.js` line 232-260:

```js
meta: {
    type: "problem",          // ← no "fixable" field
    docs: { description: "...", recommended: false, url: "..." },
    schema: [...],
    messages: { ... }
}
```

The rule is `type: "problem"` with no `fixable: "code"` field. ESLint's `--fix` therefore emits no fixers for it. Running `--fix` reports the 32 violations but produces 0 file modifications (verified via `git status` after auto-fix run — zero source-file diffs).

## Why the project's config uses a non-existent rule

`config/eslint/.peaks-rules.cjs:109` configures `'@typescript-eslint/no-duplicate-imports': 'warn'`. This ruleId was added during 4.0.16 task-2 dogfood as a replacement for `import/no-duplicates` (which was removed when `eslint-plugin-import` was removed). However, the maintainers of `@typescript-eslint/eslint-plugin` never published a rule under this name. Replacements are:
- `@typescript-eslint/consistent-type-imports` (already in config, 116 violations in baseline)
- Community lint plugins (e.g., `eslint-plugin-import` already-removed, or `eslint-plugin-no-secrets` no-importer, etc.)

## Recommendation for next slice (USER DECISION REQUIRED)

Three viable paths forward for the pilot:

1. **Drop the `@typescript-eslint/no-duplicate-imports` config line entirely.** Replace with a comment pointing to ESLint built-in `no-duplicate-imports` (real, working). Then run this pilot — but it requires 32 MANUAL fixes (not auto-fixable). Each is mechanical: merge `import { X } from 'mod'` lines into a single existing import statement. **Estimated: ~30 line diffs, all in `src/`.** This is consistent with the no-touch-stockcode rule's "Scenario B user-ack governance" path.

2. **Skip this slice. Move to slice B (`max-lines-per-function`)** — but that rule is now `error` level per task 2 promotion, and 348 violations in baseline means full-repo damage. Worse pilot candidate.

3. **Swap ruleId strategy before slices continue.** Switch from `@typescript-eslint/no-duplicate-imports` (non-existent) → ESLint built-in `no-duplicate-imports` (real) in the config. Re-baseline (config-coverage phantom violations go to 0; real violations now report correctly). Then evaluate — either auto-fix is still impossible (confirmed) OR add a small post-process script to merge duplicate import statements (custom tool, ~30 LOC). The custom tool is consistent with peaks-loop's "enhancement layer" stance.

## Recommendation

**Option 3** is best long-term but expands scope beyond 1-slice pilot.
**Option 1** is fastest path to a shippable pilot diff (manual merges), still keeps the ruleId single-ruleId scope.
**Option 2** changes slice ordering.

Recommend asking user which to take before proceeding.

## Pilot exit summary

- Pre-fix `no-duplicate-imports` violations: **32** (28 src/ + 4 tests/ + 0 packages/)
- Post-fix violations: **32 (unchanged)** — `no-duplicate-imports` is not auto-fixable in ESLint 8.57.1
- Files auto-fixed: **0** (no source files modified)
- Auto-fix surfaced unfixable violations: **all 32** (rule has no `fixable` field)
- parserOptions.project config-coverage issue: **hit at 26 other locations** (unrelated rules like `no-explicit-any`, `no-var-requires` — out-of-scope)
- Final baseline violation count: **8733 (unchanged)** — this slice did not modify `baseline.json` (no source changes means no re-baseline needed)
- Skip auto-fix, do not commit, defer to user decision on Option 1/2/3 above

## Related

- `.peaks/memory/2026-08-06-task1-task2-ship-closure.md` — task 2 lint dogfood + L3 cp-to-global lesson
- `.peaks/memory/2026-08-06-incremental-first-no-touch-stockcode-rule.md` — Scenario B ack
- `.peaks/memory/2026-08-06-4016-lint-strict-prd-todo.md` — PRD-002b source PRD
- `.peaks/memory/2026-08-06-prd002b-qa-cycle3-blocked-on-pre-existing-flakes.md` — pre-existing flakes context
