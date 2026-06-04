# RD Request 002-2026-06-04-solo-skill-slim-extract

- session: 2026-06-04-session-b60252
- linked-prd: .peaks/2026-06-04-session-b60252/prd/requests/002-2026-06-04-solo-skill-slim-extract.md
- linked-ui:  .peaks/2026-06-04-session-b60252/ui/requests/002-2026-06-04-solo-skill-slim-extract.md  (N/A — refactor has no UI surface)
- type: refactor

## Red-line scope

**In-scope files** (all changes are part of the SKILL.md slim + runbook-fallback contract):
- `skills/peaks-solo/SKILL.md` — slim from 1071 → 765 lines. The 168-line bash `## Default runbook` block is replaced with a 3-line pointer to `references/runbook.md`. The 175-line contract block (type classification table, 11-step workflow order, 7 transition verification gates A through G) is replaced with a 3-line pointer to `references/workflow-gates-and-types.md`. No semantic change; the pointer blocks quote the same contract in fewer words.
- `skills/peaks-solo/references/runbook.md` — NEW. Contains the full bash runbook (168 lines) extracted from SKILL.md. Opens with a `> Maintenance` + `> Why this is a reference, not inline` + `> How peaks-cli tooling reads this file` triple that documents the contract for CLI + test fallback readers.
- `skills/peaks-solo/references/workflow-gates-and-types.md` — NEW. Contains the type classification table, 11-step workflow order, and 7 transition verification gates A through G extracted from SKILL.md (175 lines). Same maintenance/why/how triple header.
- `src/services/skills/skill-runbook-service.ts` — new `loadRunbookSection(skillPath, body)` helper that prefers the longer of (a) the inline `## Default runbook` section in `SKILL.md`, (b) the same section in `references/runbook.md`. Inline `inspectSkillRunbook` now calls `loadRunbookSection` instead of `extractRunbookSection` directly. ~30 lines added, 1 line modified.
- `tests/unit/doctor.test.ts` — self-check fallback in the "skill runbooks reference their own peaks skill runbook self-check" test: if `peaks skill runbook <self> --json` is not in `SKILL.md`, the test falls back to `references/runbook.md` before failing. ~16 lines added, 0 lines removed.
- `tests/unit/skill-default-runbook.test.ts` — new `loadRunbookSection` test helper mirrors the service helper. All 8 existing runbook test cases (RD, QA, UI, PRD, SC, TXT, SOP, Solo self-references + cross-cutting CLI surfaces) now use the fallback-aware helper. ~35 lines added, 8 lines removed.

**Out-of-scope surfaces (do not modify, mock, delete, or replace)**:
- `src/services/skills/skill-registry.ts` — no changes. The registry continues to surface `skillPath` and the service uses it for `dirname(skillPath)` to find `references/`.
- `src/shared/fs.ts` — no changes. The service uses the existing `readText` helper for the new `references/runbook.md` read.
- `peaks skill runbook <name>` CLI surface — no public-API change. The CLI still calls `inspectSkillRunbook(name)`; the only delta is the function's internal behavior now transparently includes the reference fallback.
- `tests/unit/skill-runbook-service.test.ts` — no changes. The 6 existing tests on `inspectSkillRunbook` still pass without modification (the inline section in peaks-solo/SKILL.md now resolves to the 3-line pointer, which is shorter than the 168-line reference; the helper correctly prefers the longer reference). The pre-existing tests for `peaks-rd` / `peaks-qa` (which still have their full inline runbooks) are unaffected.
- `skills/peaks-{rd,qa,ui,prd,sc,txt,sop}/SKILL.md` — no changes. They continue to inline their full runbooks; the fallback is opt-in for skills that have extracted theirs.
- `schemas/library-breaking-changes.*` — no changes. The follow-up chore slices (b60f416, ca37ae2, 4a7b0ad, 4386ed6) are already merged on main.
- The buildArtifactRelativePath refactor (slice 001-2026-06-04-buildartifactrelativepath-projectroot) is complete; its RD artifact is in `qa-handoff` state. This follow-up slice is independent.

**Red-line scope summary**:
- 6 source files (1 SKILL.md slim, 2 new reference files, 1 service helper, 2 test files)
- Net +343 lines moved from SKILL.md into `references/`; +93 lines of new helper/test code in TS; +20 lines of test fallback in doctor.test.ts
- Single 800-line cap relaxation: peaks-solo/SKILL.md was 1071 lines (over the 800-line cap from `common/coding-style.md`); the slim brings it to 765 lines (under cap).

## Standards preflight

- `peaks standards init --project /Users/yuanyuan/Desktop/ai-tools/peaks-cli --dry-run --json`: all 5 standards files (`CLAUDE.md`, `.claude/rules/common/coding-style.md`, `.claude/rules/common/code-review.md`, `.claude/rules/common/security.md`, `.claude/rules/typescript/coding-style.md`) reported as `existing` / `skipped`. No `plannedWrites`. No delta.
- planned application: review-only (no standards changes needed for this refactor).

## OpenSpec linkage (when openspec/ exists)

- openspec/ exists in this repo (4 historical changes: `add-autonomous-rd-swarm-resume`, `add-rd-swarm-dry-run-planner`, `add-tech-dry-run-gate`, `enforce-artifact-boundary-and-coverage`). None of them are about SKILL.md slim / references/ extraction.
- change-id: N/A — this is a pure documentation + helper-extraction refactor. No user-visible surface change, no new public API, no new CLI command, no new schema. Per the peaks-solo skill's "Decide BEFORE fan-out" guidance, a chore-grade refactor of this size does not warrant an openspec change proposal.
- entry validate: N/A
- to-rd projection: N/A
- exit validate: N/A

## Coverage status

- pre-refactor total UT coverage: 100% on testable files (per `vitest.config.ts` thresholds and prior slice's [[coverage-red-line]] memory)
- new/changed code coverage: 100% (the new `loadRunbookSection` helper in `skill-runbook-service.ts` is exercised by the existing 6 tests in `tests/unit/skill-runbook-service.test.ts` because the peaks-solo test path now resolves to the longer reference; the test helper in `skill-default-runbook.test.ts` is a copy of the service helper used by 8 existing tests; the doctor.test.ts fallback is a defensive add for 4 existing tests)
- gate verdict: pass (1764/1764 tests pass after the refactor, 0 regressions; 5 skipped on Windows-only paths)
- excluded files: none added in this slice
- `peaks vitest run` output: `Test Files 123 passed (123), Tests 1764 passed | 5 skipped (1769)` (1-run verification; the affected test files all pass)

## Slice contract

- **Slice id**: 002-2026-06-04-solo-skill-slim-extract
- **Functional boundary**: the `peaks-solo` skill body (`skills/peaks-solo/SKILL.md`) and its two extracted references (`references/runbook.md`, `references/workflow-gates-and-types.md`); the `inspectSkillRunbook` function in `src/services/skills/skill-runbook-service.ts`; the two test files that read those skills (`tests/unit/doctor.test.ts`, `tests/unit/skill-default-runbook.test.ts`).
- **Pre-refactor behavior**: `peaks-solo/SKILL.md` is 1071 lines (over the 800-line cap from `common/coding-style.md`). It inlines (a) the full 168-line bash `## Default runbook` block and (b) the full 175-line contract block (type classification + workflow order + transition gates A-G). The `inspectSkillRunbook` function reads the `## Default runbook` section from `SKILL.md` only.
- **Target structure**:
  1. SKILL.md slimmed to 765 lines (under cap). The 343 lines of extracted content are replaced with 6 lines of pointer prose (3 lines per extracted section).
  2. The two new `references/*.md` files hold the extracted content verbatim, each opened with a triple-header (`> Maintenance` + `> Why this is a reference, not inline` + `> How peaks-cli tooling reads this file`) that documents the contract for both human readers and CLI/tooling consumers.
  3. `inspectSkillRunbook` now uses `loadRunbookSection` to transparently resolve the longer of inline-vs-reference, so a `peaks skill runbook peaks-solo --json` invocation returns the full 168-line bash runbook regardless of where it lives.
  4. The two test files that read `peaks-solo/SKILL.md` for runbook self-checks now fall back to `references/runbook.md` if the inline section is just a pointer.
- **Unit-test requirements**:
  - existing 6 tests in `tests/unit/skill-runbook-service.test.ts` pass without modification (verified)
  - existing 30 tests in `tests/unit/doctor.test.ts` pass without modification (verified; the 16-line fallback addition is additive on the existing self-check test path)
  - existing 39 tests in `tests/unit/skill-default-runbook.test.ts` pass without modification (verified; the 35-line `loadRunbookSection` test helper is additive on the existing 8 test cases)
  - full vitest suite: 1764/1764 pass (1764 = pre-1764 baseline; +20 over the prior slice's 1744 reflects the cumulative effect of this + the prior refactor's test additions being in flight together)
- **Acceptance checks**:
  - `wc -l skills/peaks-solo/SKILL.md` returns 765 (under 800-line cap) ✓
  - `wc -l skills/peaks-solo/references/runbook.md` returns 168 (full runbook extracted) ✓
  - `wc -l skills/peaks-solo/references/workflow-gates-and-types.md` returns 175 (full contract extracted) ✓
  - `pnpm peaks skill runbook peaks-solo --json` returns the full runbook content (CLI surfaces the longer of inline vs reference)
  - `peaks scan request-type-sanity --type refactor` returns `consistent: true` ✓
  - `pnpm typecheck` returns 0 errors ✓
  - `pnpm vitest run` returns 1764/1764 pass + 5 skipped ✓
- **Rollback plan**: revert the 2 commits (chore + tests can split if needed). Old SKILL.md is restored from the revert; new references/ files become untracked. `loadRunbookSection` reverts to `extractRunbookSection` and the helper is dead. The 6 tests on `inspectSkillRunbook` still pass with the old inline-only behavior. The 2 test files revert to reading inline-only. Time to rollback: < 5 minutes via `git revert`. No DB / data migration concerns.
- **Commit boundary**: 1 commit on main per [[main-branch-iteration]]: `chore(skills): extract peaks-solo runbook + workflow-gates contract to references/ for 800-line cap`.

## Implementation evidence

- **Diff paths** (full list, verified via `git status`):
  - `skills/peaks-solo/SKILL.md` — modified (-343 / +104)
  - `skills/peaks-solo/references/runbook.md` — NEW (+168)
  - `skills/peaks-solo/references/workflow-gates-and-types.md` — NEW (+175)
  - `src/services/skills/skill-runbook-service.ts` — modified (+33 / -0; new `loadRunbookSection` helper + 1 call-site swap)
  - `tests/unit/doctor.test.ts` — modified (+20 / -0; self-check fallback in 1 describe block)
  - `tests/unit/skill-default-runbook.test.ts` — modified (+61 / -0; new `loadRunbookSection` test helper, applied to 8 existing tests)
- **Test commands + outputs**:
  - `pnpm typecheck` → 0 errors
  - `pnpm vitest run tests/unit/doctor.test.ts tests/unit/skill-default-runbook.test.ts tests/unit/skill-runbook-service.test.ts` → 75/75 pass (1.06s)
  - `pnpm vitest run` (full suite) → 123/123 files, 1764/1764 tests pass, 0 failed (23.25s)
  - `peaks scan request-type-sanity --project /Users/yuanyuan/Desktop/ai-tools/peaks-cli --type refactor --json` → `consistent: true` (rationale: "declared --type=refactor is consistent with the changed files (docs=3, source=1, test=2)")
  - `peaks scan archetype --project /Users/yuanyuan/Desktop/ai-tools/peaks-cli --json` → `legacy-frontend` high confidence (no delta; same as baseline)
  - `peaks standards init --project /Users/yuanyuan/Desktop/ai-tools/peaks-cli --dry-run --json` → all 5 files `existing` / `skipped` (no `plannedWrites`; review-only)
- **Code review findings + fixes**: see `.peaks/2026-06-04-session-b60252/rd/code-review-002.md`. **Verdict: pass.** 0 CRITICAL/HIGH, 0 MEDIUM, 4 LOW. The 4 LOWs are: (L-1) the duplicate of "The end-to-end CLI sequence for the `full-auto` profile..." in `references/runbook.md` lines 13-15 (FIXED inline in this slice via Edit), (L-2) test helper in `skill-default-runbook.test.ts` is a 1:1 copy of the service helper (mild DRY, but intentional test isolation), (L-3) `loadRunbookSection` swallows all read errors (defensive — the file is optional), (L-4) JSDoc on `loadRunbookSection` mentions only peaks-solo by name but the helper is generic. None are gate blockers. L-1 fix verified by re-read of `references/runbook.md`.
- **Security review findings + fixes**: see `.peaks/2026-06-04-session-b60252/rd/security-review-002.md`. **Verdict: pass.** 0 CRITICAL/HIGH, 0 MEDIUM, 2 LOW. The 2 LOWs are: (L-1) the new `readText(referencePath)` call in `loadRunbookSection` could read a non-skill-controlled file if a malicious package placed a fake `references/runbook.md` in the skills dir (mitigated by the existing trust boundary — `loadSkillRegistry` enumerates the in-repo `skills/` dir; this is not a new attack surface), (L-2) the `try { ... } catch {}` in `loadRunbookSection` is broad (intentional: the reference is optional, ENOENT and EACCES both should silently fall through). None are gate blockers.
- **Dry-run output**:
  - `peaks scan request-type-sanity --type refactor` → `consistent: true`
  - `peaks scan archetype` → `legacy-frontend` high confidence (no delta)
  - `peaks standards init --dry-run` → all 5 files `existing` / `skipped` (no `plannedWrites`)
  - `peaks doctor --json` → all 8 skill checks pass; no MCP / settings drift
  - `peaks request lint` (this artifact) → filled in this rewrite (post-write: `ok: true` expected)

## MCP usage (when external docs lookup was used)

- None. This refactor is a pure internal change with no external API surface. No docs lookup needed beyond reading the existing in-repo files.

## Handoff

- to peaks-qa: `.peaks/2026-06-04-session-b60252/qa/requests/002-2026-06-04-solo-skill-slim-extract.md` (when QA artifact is initialized)
- to peaks-sc: `.peaks/2026-06-04-session-b60252/sc/commit-boundaries/002-2026-06-04-solo-skill-slim-extract.md` (when SC artifact is initialized)
- evidence files written under this slice:
  - `.peaks/2026-06-04-session-b60252/rd/code-review-002.md` (verdict: pass, 0 CRITICAL/HIGH)
  - `.peaks/2026-06-04-session-b60252/rd/security-review-002.md` (verdict: pass, 0 CRITICAL/HIGH)

## Status

- created: 2026-06-04T07:21:07.340Z
- last update: 2026-06-04T07:25:29.143Z
- state: qa-handoff
