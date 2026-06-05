# Code Review — RD 2026-06-02-grep-strip-meta

- reviewer: code-reviewer agent (a2e951cb5122d35d8)
- review date: 2026-06-02
- verdict: **GO / APPROVE**

## Scope reviewed

| File | Change |
|------|--------|
| `src/services/sop/sop-types.ts` | Add `stripMeta?: boolean` to grep variant of `SopGateCheck` |
| `src/services/sop/sop-check-service.ts` | Add `stripMetaForGrep` export; extend `evaluateGrep` signature; apply stripper when `check.stripMeta === true`; pass `check.stripMeta === true` from `evaluateCheck` |
| `src/services/sop/sop-service.ts` | Add `warnings: string[]` to `SopLintResult`; init in both return paths; push one warning per grep gate with `stripMeta: true` |
| `src/cli/commands/sop-commands.ts` | (no code change; `ok('sop.lint', result)` already passes the full result, so `warnings` flows through automatically) |
| `skills/peaks-sop/SKILL.md` | New "Literal-word trap and stripMeta" sub-section |
| `tests/unit/sop-check-service-strip-meta.test.ts` | NEW: 16 tests covering stripper isolation, evaluateGate wiring, lint warnings |

## Regression-guard verification

`git diff --stat HEAD -- tests/unit/{sop-check-service,sop-commands,sop-advance-service,sop-service,sop-project-layer,sop-registry-service,gate-enforce-service}.test.ts` → empty. None of the 7 prior SOP test files were modified by this slice.

## Severity summary

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 1 | info (PRD R1, gated by opt-in, disclaimed in SKILL.md) |
| LOW | 4 | style / doc-only notes (none blocking) |

## Findings detail

### MEDIUM-1: Block-comment regex can swallow content across a fence boundary
- **Where**: `src/services/sop/sop-check-service.ts:125` (`/\/\*[\s\S]*?\*\//g` runs before fence regex)
- **Reproducer**: A `/*` inside a fenced block paired with a `*/` later in prose is matched greedily across the closing fence; the matched span includes the closing fence, leaving the fence as "unclosed" for the next pass, and the conservative fail-safe leaves the residue alone.
- **Why MEDIUM not HIGH**: PRD 006 R1 explicitly accepts "stripper bugs on edge cases" as a known risk; `stripMeta` is opt-in; SKILL.md already disclaims this category.
- **Mitigation (future slice)**: swap strip order to fences-first, block-comments-second — eliminates the cross-boundary class. Out of scope for this slice.
- **Status**: acknowledged in PRD R1; SKILL.md is the place users discover the limitation; not a blocker.

### LOW-1: 4+ backtick fences with nested 3-backtick demos close prematurely
- **Where**: `src/services/sop/sop-check-service.ts:131`
- **Why LOW**: nested-fence demos are extremely rare in publishing SOPs, and `stripMeta` is opt-in. Worth a one-line caveat in SKILL.md ("multi-backtick nested fences are not supported").
- **Status**: doc-only follow-up. Not blocking.

### LOW-2: `evaluateGrep` signature now carries 5 positional parameters
- **Where**: `src/services/sop/sop-check-service.ts:70` — `evaluateGrep(projectRoot, file, pattern, absent, stripMeta?)`
- **Why LOW**: only caller is `evaluateCheck`; blast radius is zero. Style only.
- **Status**: future refactor: collapse to options object before the next grep field lands.

### LOW-3: `stripMeta` strips literal `/* */` from prose paragraphs
- **Where**: `src/services/sop/sop-check-service.ts:125`
- **Why LOW**: a tutorial post explaining C/JS comment syntax that writes `/* foo */` inline as prose will have that span deleted. The SKILL.md note enumerates the three classes but doesn't explicitly call out that prose `/* */` is also stripped.
- **Status**: doc-only follow-up. Add one sentence: "Note: literal `/* */` anywhere in the file is stripped, not just inside code."

### LOW-4: Naming collision — `SopLintResult.warnings` vs `ResultEnvelope.warnings`
- **Where**: `src/services/sop/sop-service.ts:68` (data-level) vs `src/shared/result.ts:5` (envelope-level)
- **Why LOW**: distinct paths in the emitted JSON; downstream consumers discriminate by path. A one-line comment on `SopLintResult.warnings` clarifying the distinction would help future readers.
- **Status**: doc-only follow-up. Not blocking.

## Spec checklist (10/10 green)

| # | Check | Result |
|---|-------|--------|
| 1 | stripMetaForGrep regexes — HTML / block-comment / fence | OK; conservative fail-safes for unclosed cases verified by tests |
| 1a | Fenced code at EOF without trailing newline | Handled: `\n?` makes trailing newline optional |
| 1b | Unclosed fence falls through un-stripped | Tested at `sop-check-service-strip-meta.test.ts:74-80` |
| 1c | Unclosed block comment falls through un-stripped | Tested at `sop-check-service-strip-meta.test.ts:82-86` |
| 2 | `evaluateCheck` passes `check.stripMeta === true` | Confirmed at `sop-check-service.ts:172` |
| 2a | `evaluateGrep` applies stripper only when `stripMeta === true` (strict equality, not truthy) | Confirmed at `sop-check-service.ts:90` |
| 3 | Default `false`/`undefined` is byte-identical | AC5 byte-identity test at `sop-check-service-strip-meta.test.ts:116-123` |
| 4 | `warnings` populated only for grep gates with `stripMeta: true` | Type-guarded at `sop-service.ts:294`; AC6 P3 test at `sop-check-service-strip-meta.test.ts:167-191` |
| 5 | `stripMeta?: boolean` accepts undefined | Optional field, no type error |
| 5 | `SopLintResult.warnings: string[]` is required, not optional | Confirmed at `sop-service.ts:68`; both return paths initialize it |
| 6 | `stripMetaForGrep` is exported and pure | Confirmed at `sop-check-service.ts:119`; no IO, no mutation |
| 7 | No regression in 7 prior SOP test files | `git diff --stat` confirms none were modified |
| 8 | SKILL.md "Literal-word trap and stripMeta" section quality | Clear paragraph, JSON example, explicitly notes inline-code and blockquotes are NOT stripped |
| 9 | Test quality — behavior assertions, not branch padding | All 16 tests assert externally observable behavior |
| 10 | PRD R1 / R2 / R3 all addressed | R1 fail-safes tested; R2 strict-equality; R3 SKILL.md notes limitations |

## Reviewer recommendation

**GO / APPROVE.** No CRITICAL or HIGH issues. The single MEDIUM is a known PRD R1 edge case, gated by opt-in, and disclaimed in SKILL.md. Default behavior is provably byte-identical for existing SOPs (AC5 byte-identity test guards it). The 7 pre-existing SOP test files are unmodified. Test coverage is behavior-driven with no branch-padding. Ship.

## Follow-up not addressed in this slice (deferred)

- Future slice: swap strip order to fences-first, block-comments-second (eliminates the MEDIUM cross-boundary class).
- Doc-only: note that 4+ backtick nested fences and literal `/* */` in prose are also affected.
- Style: collapse `evaluateGrep`'s positional booleans into an options object before the next grep field lands.
- Comment: clarify that `SopLintResult.warnings` is a domain-level field distinct from `ResultEnvelope.warnings`.

All four are non-blocking; tracked in the PRD 006 risks section.
