# Peaks-Cli Solo Handoff Capsule

- session: 2026-06-04-session-b60252
- title: 吸收LLM经验教训+三方库版本感知 (continued: 治理未完成的 follow-up)
- mode: full-auto
- date: 2026-06-04
- rid: 002-2026-06-04-solo-skill-slim-extract
- type: refactor
- verdict: pass (10/10 acceptance cases; 0 CRITICAL/HIGH/MEDIUM security findings; no perf surface)

## Slice summary

This is the second of two follow-up slices cleaning up the prior session's unfinished work. The first follow-up (slice 001-2026-06-04-buildartifactrelativepath-projectroot) is in `qa-handoff` state. This follow-up (slice 002-2026-06-04-solo-skill-slim-extract) extracts the 343 lines of contract content from `peaks-solo/SKILL.md` into two new sibling reference files, slimming the orchestrator skill from 1071 → 765 lines (under the 800-line cap from `common/coding-style.md`).

## Decisions

- **Slim targets**: the two blocks extracted are (1) the 168-line bash `## Default runbook` (executable CLI transcription that doesn't change between runs) and (2) the 175-line contract block (type classification table + 11-step workflow order + 7 transition verification gates A-G). Both are reference data, not orchestration prose.
- **Pointer prose**: 3 lines per extracted section, in plain text, no fancy cross-link markup. The `> Maintenance`, `> Why this is a reference, not inline`, `> How peaks-cli tooling reads this file` triple-header on each new reference file documents the contract for both human readers and CLI/tooling consumers.
- **CLI fallback**: `inspectSkillRunbook` gains a new `loadRunbookSection(skillPath, body)` helper that prefers the longer of inline-vs-reference. This is a transparent behavior change at the public-API level — the CLI surface `peaks skill runbook <name> --json` is unchanged, but the output for `peaks-solo` now resolves to the 168-line reference.
- **Type sanity**: declared `chore` initially, but `peaks scan request-type-sanity --type chore` returned `consistent: false` (the source file change `src/services/skills/skill-runbook-service.ts` is not pure hygiene). Re-classified to `refactor`, which returned `consistent: true` (docs=3, source=1, test=2). This matches the spec: a refactor = restructure code without changing user-visible behavior.
- **Inline duplicate fix**: LLM-driven extraction of `references/runbook.md` duplicated the introductory prose. Fixed inline via Edit (line 13-15 reduced from duplicate to single). Caught by code-review L-1.
- **No CLI change**: per `.claude/rules/common/dev-preference.md`, no new `peaks <cmd>` is added. The behavior change is internal to `inspectSkillRunbook`, transparent to its caller.

## Artifact paths

- PRD: `.peaks/2026-06-04-session-b60252/prd/requests/002-2026-06-04-solo-skill-slim-extract.md`
- RD request: `.peaks/2026-06-04-session-b60252/rd/requests/002-2026-06-04-solo-skill-slim-extract.md` (state: qa-handoff)
- RD code review: `.peaks/2026-06-04-session-b60252/rd/code-review-002.md` (verdict: pass, 0 CRITICAL/HIGH, 0 MEDIUM, 4 LOW; L-1 fixed inline)
- RD security review: `.peaks/2026-06-04-session-b60252/rd/security-review-002.md` (verdict: pass, 0 CRITICAL/HIGH, 0 MEDIUM, 2 LOW)
- QA request: `.peaks/2026-06-04-session-b60252/qa/requests/002-002-2026-06-04-solo-skill-slim-extract.md` (state: verdict-issued)
- QA test cases: `.peaks/2026-06-04-session-b60252/qa/test-cases/002-2026-06-04-solo-skill-slim-extract.md` (10 cases)
- QA test report: `.peaks/2026-06-04-session-b60252/qa/test-reports/002-2026-06-04-solo-skill-slim-extract.md` (verdict: pass)
- QA security findings: `.peaks/2026-06-04-session-b60252/qa/security-findings.md` (verdict: pass)
- QA performance findings: `.peaks/2026-06-04-session-b60252/qa/performance-findings.md` (verdict: N/A)

## Code paths

- 6 source files changed: `skills/peaks-solo/SKILL.md` (slim -239), `skills/peaks-solo/references/runbook.md` (NEW +168), `skills/peaks-solo/references/workflow-gates-and-types.md` (NEW +175), `src/services/skills/skill-runbook-service.ts` (+33, new `loadRunbookSection` helper), `tests/unit/doctor.test.ts` (+20, fallback in self-check), `tests/unit/skill-default-runbook.test.ts` (+61, new `loadRunbookSection` test helper applied to 8 cases).
- Commit: `f0fdc95 chore(skills): extract peaks-solo runbook + workflow-gates contract to references/ for 800-line cap`

## Standards deltas

- `peaks standards init --dry-run`: 5 files (`CLAUDE.md`, `.claude/rules/common/coding-style.md`, `.claude/rules/common/code-review.md`, `.claude/rules/common/security.md`, `.claude/rules/typescript/coding-style.md`) all reported as `existing` / `skipped`. **No plannedWrites. No delta.** Review-only.

## Test results

- `pnpm typecheck` → 0 errors
- `pnpm vitest run` → 123/123 files, 1764/1764 pass + 5 skipped (23.25s)
- `peaks scan request-type-sanity --type refactor` → `consistent: true` (docs=3, source=1, test=2)
- `peaks scan archetype` → `legacy-frontend` high confidence (no delta)
- `peaks skill runbook peaks-solo --json` → peaksCommandCount = 32 (full runbook surfaced via fallback)

## Outstanding / next action

- The buildArtifactRelativePath refactor (slice 001) is still in `qa-handoff` state with QA artifact at `draft`. The QA test report and findings have NOT been written for that slice. The next follow-up (slice 003) should close out slice 001: write the QA test report + findings, transition QA to `verdict-issued`, then SC + commit. This is the ONLY outstanding item from the two pending follow-ups.
- All other uncommitted `.peaks/` artifacts (RD/QA files) and `.peaks/.active-skill.json` / `.peaks/2026-06-04-session-b60252/session.json` are workspace state, not source — they should remain uncommitted (per the peaks workspace policy in the skill).
- Standards preflight showed no delta; no standards apply needed for this slice.

## Memory markers (peaks-txt embeds these for memory extraction)

<!-- peaks-memory:start kind=convention -->
Skill file structure: skills in `skills/<name>/SKILL.md` may extract long-form contract / runbook blocks to `references/*.md` siblings. The orchestrator CLI (`peaks skill runbook <name>`) and the audit tests (`tests/unit/doctor.test.ts`, `tests/unit/skill-default-runbook.test.ts`) prefer the longer of inline-vs-reference for the `## Default runbook` section. The new `loadRunbookSection(skillPath, body)` helper in `src/services/skills/skill-runbook-service.ts` is the canonical implementation; copy it in test files (mild DRY, intentional test isolation). Use a 3-line pointer in SKILL.md and a triple-header (`> Maintenance` + `> Why this is a reference, not inline` + `> How peaks-cli tooling reads this file`) on each new reference.
<!-- peaks-memory:end -->

<!-- peaks-memory:start kind=convention -->
Type sanity for refactor: when a slice touches 1 source file + 3 docs files + 2 test files, `peaks scan request-type-sanity --type chore` returns `consistent: false` (the source change disqualifies `chore`). Re-classify to `refactor` for the file mix `docs=3, source=1, test=2`. The trigger condition: any production-source edit in the diff = `chore` no longer applies.
<!-- peaks-memory:end -->

<!-- peaks-memory:start kind=lesson -->
LLM-driven markdown extraction duplicates content. When extracting content from one file to another via a single LLM turn, watch for duplicated paragraphs. The L-1 finding on `references/runbook.md` (line 13 + 15 both contained "The end-to-end CLI sequence for the `full-auto` profile...") is a typical artifact. Mitigation: code-review the new file in lockstep with the extraction; never trust that an LLM move is verbatim. The `peaks skill doctor` self-checks did not catch this because they only check for the `## Default runbook` section marker, not its content.
<!-- peaks-memory:end -->
