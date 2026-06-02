# Tech-doc — RD 2026-06-02-grep-strip-meta

> Generated 2026-06-02. Linked from RD artifact.
> Scope: add `stripMeta?: boolean` to `grep` gate check; pure-string stripper; lint warning.

## Architecture decisions

**1. `stripMeta` is a NEW optional field on the `grep` variant of `SopGateCheck`.** Default `false` (and `undefined`) preserves byte-identical behavior. This is a backward-compatible field addition; existing 7 SOP test files MUST pass unchanged. The default is decided at the evaluator level (not at lint), so authors who don't touch their manifests get exactly today's behavior.

**2. The stripper is a pure string transform — no dependencies, no parsers.** Three regex replacements in order:
  - HTML comments: `/<!--[\s\S]*?-->/g`
  - Fenced code blocks: `/^```[^\n]*\n[\s\S]*?(?:^```[^\n]*\n?|\n?$)/gm` (3+ backticks opening, matched by `^```\n` body, until `^```\n` close or EOF; unclosed fences fall through un-stripped — conservative)
  - Block comments: `/\/\*[\s\S]*?\*\//g` (C-style; spans .ts/.js/.c/.cpp code that the same SOP will gate)

**3. strip happens BEFORE `regex.test`.** The semantics are "evaluate the regex on the rendered content the author meant to show readers, not on the source as written." This is a single change point in `evaluateGrep` (`sop-check-service.ts:70`); the `file`/`pattern`/`absent` parameters are unchanged.

**4. Lint emits a `warnings` field (new) only when a gate declares `stripMeta: true`.** The existing `findings` array (errors that block lint) is unchanged. Adding `stripMeta: true` does NOT add a finding. This satisfies PRD P3 (lint doesn't add noise to non-upgraded SOPs) and OQ3 (warnings vs findings).

**5. No new dependency.** Pure JS regex. The Vitest test count grows by ~6 (one per AC1-AC4 + AC5 byte-identity guard). New test file `tests/unit/sop-check-service-strip-meta.test.ts` is added; existing test files are NOT touched (per AC7).

## Component changes

| File | Role | Why |
|------|------|-----|
| `src/services/sop/sop-types.ts` | modify: add `stripMeta?: boolean` to the `grep` variant of `SopGateCheck` | G3 — wire the new optional field at the type level |
| `src/services/sop/sop-check-service.ts` | modify: extend `evaluateGrep` to strip meta before regex.test when `stripMeta === true`; export a new pure helper `stripMetaForGrep(content: string): string` so tests can unit-test the stripper in isolation | G1/G2 — single change point in the evaluator; helper export enables focused tests |
| `src/services/sop/sop-service.ts` | modify: add `warnings: string[]` field to `SopLintResult`; emit one warning per gate that declares `stripMeta: true` | G4/AC6 — surfacing the behavior change to authors without making lint fail |
| `src/services/sop/sop-types.ts` | modify: add `warnings?: string[]` to `SopLintResult` | wire the new field at the type level |
| `src/cli/commands/sop-commands.ts` | modify: include `warnings` in the `sop lint` JSON response (currently only includes `findings`) | G4 — author-facing |
| `tests/unit/sop-check-service-strip-meta.test.ts` | new file: focused unit tests for the stripper + the evaluator wiring | AC1-AC5 — coverage for the new code, isolated from existing tests |

**No new packages. No deletions. No OpenSpec change (slice below the engineering-change bar used by `openspec/changes/`).**

**Path verification (Gate A2 evidence):**
```
$ ls src/services/sop/sop-types.ts src/services/sop/sop-check-service.ts \
       src/services/sop/sop-service.ts src/cli/commands/sop-commands.ts \
       tests/unit/sop-check-service-strip-meta.test.ts
src/services/sop/sop-types.ts
src/services/sop/sop-check-service.ts
src/services/sop/sop-service.ts
src/cli/commands/sop-commands.ts
... sop-check-service-strip-meta.test.ts: No such file  ← will be created in impl
```

The new test file does not exist yet; will be created during implementation. The other 4 paths exist.

## Data flow

1. Manifest loaded (`parseStoredMemoryFile` or `readFileSync` from the lint path) — same as today.
2. Lint (`sop-service.ts:lintManifest`) walks gates:
   - If gate is `grep`-type and `check.stripMeta === true`, push a string to `warnings`.
   - `findings` are unchanged.
3. CLI (`sop-commands.ts:lint` action) returns `{ok, command, data: {findings, warnings, ...}}`.
4. At evaluate time (`sop-check-service.ts:evaluateGrep`):
   - If `check.stripMeta === true`, replace `content` with `stripMetaForGrep(content)` BEFORE the existing `regex.test`.
   - Otherwise, the existing `regex.test(content)` runs unchanged.
5. Verdict logic (pass/fail/blocked) is unchanged.

## CSS / style changes

None. CLI only.

## API contract changes

- `SopGateCheck` (`grep` variant) gains `stripMeta?: boolean`. Existing 7 SOP test files do not declare this field and are unaffected.
- `SopLintResult` gains `warnings: string[]`. CLI output for `sop lint` gains a `warnings` field alongside `findings`. Existing CLI consumers that read only `findings` are unaffected.
- No new exit codes, no new error envelopes.

## Dependencies

None. No `package.json` changes. No `node_modules` touch.

## Risk notes (carried from PRD 006)

- **R1** (stripper bugs on edge cases): unclosed fences / unclosed block comments fall through un-stripped (conservative fail-safe). Three fixture tests cover unclosed-input.
- **R2** (other domains may depend on raw-text match): opt-in only; lint warns; default false. Documented in SKILL.md one-paragraph.
- **R3** (users may want more meta stripped, e.g. inline code or blockquotes): explicitly OUT of this PRD; document in SKILL.md as "future PRD candidates."

## Rollback plan

Revert the 5 changes. No schema migration, no data migration, no manifest migration. SOPs that have already declared `stripMeta: true` would simply become unknown-field objects (lint would not warn, evaluator would treat as `false`).
