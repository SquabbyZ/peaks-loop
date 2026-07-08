# 4.0.0-beta.5 — peaks-solo Dispatcher: Concatenated Execution Plan

> **Single-file entry point** for the 4.0.0-beta.5 release. The actual per-slice plans are:
> - `index.md` (overview, hard constraints, slice map, parallelism, risks)
> - `s0-skill-search-cli.md` (S0: peaks skill search CLI)
> - `s1-peaks-solo-skill.md` (S1: peaks-solo dispatcher skill)
> - `s2-integration-and-surface.md` (S2: marketplace + CHANGELOG + README)
> - `s3-dogfood.md` (S3: dogfood integration test + manual run + 4-section brief)
>
> This file is a **concatenation** for inline execution. Sub-agents reading this should also reference the per-slice plan files for full detail.

**Goal:** Land `peaks-solo` dispatcher + `peaks skill search` CLI as 4.0.0-beta.5. 0 breaking change to 3.x / 4.x.

**Architecture:** 4 slices, each independently shippable but MUST ship together (HC-1). S0 and S1 fan-out in parallel; S2 waits for both; S3 waits for S2.

**Tech Stack:** TypeScript ≥ 5.7 strict ESM, Commander, Zod, Vitest, no new deps.

**Spec:** `docs/superpowers/specs/2026-07-08-peaks-solo-dispatcher-design.md`

**Job mode:** NO (single-rid release; this is a sub-deliverable plan, not a Job)

**Mode concept:** NOT applicable to peaks-solo. peaks-solo is dispatcher, no assisted/strict/full-auto/swarm 4-mode (those are 2026-07-05 peaks-code residual). Long tasks = auto; non-long = LLM thinking; user decision points = AskUserQuestion only.

---

## Hard Constraints (inherited verbatim from spec §0 + plan index)

- **HC-1 一次到位:** All 4 slices ship in 4.0.0-beta.5 together.
- **HC-2 不计成本:** No degradation of `peaks skill search` to `peaks skill list | grep`. No reuse of peaks-code's Step 0 anchor.
- **HC-3 不计时间:** Fan-out sub-agents within each slice; sub-agent completes fully before next starts.
- **HC-4 禁止假绿:** Every "完成" report MUST include raw command output with N/N counts.
- **HC-5 禁止偷懒:** Do not skip any deliverable.
- **HC-6 全量回归:** Each slice sign-off = `pnpm vitest run` (full) green + skill list / help smoke.
- **HC-7 7 天 rename 红线:** After 4.0.0-beta.5 ships, peaks-* name locked for 7 days.
- **HC-8 peaks-code 0 改动:** No src/** in skills/peaks-code/; S2 may add ≤ 20 字 to peaks-code SKILL.md description.
- **HC-9 Human-NL-Choice-Only / Two-Forms-Only 兼容:** All user decision points = AskUserQuestion; no free-text.
- **HC-10 老入口保留:** 3.x / 4.x /peaks-code /peaks-content /peaks-doctor continue to work.
- **HC-11 dispatcher 比 orchestrator 薄:** peaks-solo does NOT write code / PRD / vitest / Loop Engineering Asset.

---

## Task 1: S0 — `peaks skill search` CLI

**See:** `s0-skill-search-cli.md` for full scope.

**Files (4 sub-agents fan-out, 1 verifier):**
- `src/services/skill/skill-search-service.ts` (new) — Zod-validated `searchSkills({query?, tag?, domain?, limit?})` pure function
- `src/cli/commands/skill-search-commands.ts` (new) — Commander wiring
- `src/cli/commands/skill-commands.ts` (modify minimal) — register `search` subcommand
- `tests/unit/skill-search.test.ts` (new) — 10 unit cases
- `tests/integration/skill-search-cli.test.ts` (new) — 5 integration cases

**Exit conditions:**
- All 5 files exist
- `peaks skill search --query "code"` returns peaks-code
- `peaks skill search --query "xxxxx"` returns `[]`
- Full `pnpm vitest run` green
- 0 lines under `skills/peaks-code/`

**Karpathy:** append verbatim block from `peaks-rd/references/rd-sub-agent-dispatch.md` to each sub-agent dispatch prompt.

---

## Task 2: S1 — `peaks-solo` Dispatcher Skill

**See:** `s1-peaks-solo-skill.md` for full scope.

**Files (5 sub-agents fan-out, 1 verifier):**
- `skills/peaks-solo/SKILL.md` (new) — frontmatter + 6 sections (角色定义 / 触发条件 / triage / 兜底 / 沉淀 / Out of scope)
- `skills/peaks-solo/references/triage-decision-table.md` (new) — keyword → leaf skill table (≥ 10 rows)
- `skills/peaks-solo/references/fallback-tool-inventory.md` (new) — allowed + blocked tools
- `skills/peaks-solo/references/sediment-prompt-template.md` (new) — 4-option AskUserQuestion
- `tests/unit/peaks-solo.test.ts` (new) — 7 unit cases (frontmatter parse + NOT clause parse + trigger presence + 3 references parse)

**Exit conditions:**
- All 5 files exist
- `peaks skill list` shows peaks-solo with "Dispatcher" in description
- Full `pnpm vitest run` green
- 0 lines under `skills/peaks-code/`

**Karpathy:** append verbatim block.

---

## Task 3: S2 — Integration & Surface

**See:** `s2-integration-and-surface.md` for full scope.

**Files (4 sub-agents fan-out + 1 optional, 1 verifier):**
- `.claude-plugin/marketplace.json` (modify 1 entry) — add peaks-solo before peaks-code
- `CHANGELOG.md` (modify 1 release block) — `## 4.0.0-beta.5 — 2026-07-08` with `### Added — peaks-solo dispatcher` + verification lines
- `README.md` (modify 1 paragraph) — peaks-solo paragraph after peaks-code section
- `README-en.md` (modify 1 paragraph) — English version
- `skills/peaks-code/SKILL.md` (modify optional, ≤ 20 字) — pointer to peaks-solo

**Exit conditions:**
- All files exist
- `peaks skill list` shows peaks-solo first
- `peaks code/content/doctor --help` exit 0 with identical pre-S0 output
- Full `pnpm vitest run` green
- 0 lines (or ≤ 1 line) under `skills/peaks-code/`

**Karpathy:** append verbatim block.

---

## Task 4: S3 — Dogfood

**See:** `s3-dogfood.md` for full scope.

**Files (3 sub-agents, 1 verifier):**
- `tests/integration/dispatcher-flow.test.ts` (new) — 7 integration cases (T-1..T-7)
- `.peaks/_runtime/<sessionId>/dogfood/dispatcher-run.log` (new, gitignored) — raw run log
- `.peaks/memory/2026-07-08-peaks-solo-dogfood.md` (new) — 4-section evidence brief

**Manual procedure (1-time, performed by main LLM):**
1. `peaks skill list` → save first 5 lines to log
2. `peaks skill search --query "github"` → save JSON to log
3. Confirm 0 candidates
4. Document peaks-solo's triage decision (zero-candidate → self-plan → WebSearch since deep-search not installed)
5. Document the sediment proposal (AskUserQuestion 4 options)
6. User pick (a) lesson → write this brief

**Exit conditions:**
- All 3 files exist
- Integration test 7/7 pass
- Full `pnpm vitest run` green
- HC-11 verified: 0 lines added in `src/`
- `peaks workflow verify-pipeline --rid peaks-solo-beta.5 --project . --json` exit 0

**Karpathy:** append verbatim block.

---

## Execution order

```
S0 ──┐
     ├── S2 ── S3
S1 ──┘
```

S0 and S1 run in parallel. S2 waits for both. S3 waits for S2.

**Default run mode:** `full-auto` for S0 / S1 / S3; `assisted` for S2 (user must freeze CHANGELOG wording per spec §1.1). **Job mode:** NO (single-rid release).

---

## Final acceptance (after S3 sign-off)

- [ ] All 10 ACs from spec §4 pass
- [ ] All 7 hard constraints HC-1..HC-7 honored (HC-8..HC-11 are ongoing)
- [ ] `pnpm vitest run` green (full)
- [ ] `peaks workflow verify-pipeline --rid peaks-solo-beta.5 --project . --json` exit 0
- [ ] CHANGELOG has 4.0.0-beta.5 block
- [ ] 4.0.0-beta.5 commit is ready for user to push + publish
- [ ] user-decision 2026-07-08 reference still valid (HC-1..HC-11 not violated)

---

## File map (final state after 4.0.0-beta.5)

| File | Status |
|---|---|
| `src/services/skill/skill-search-service.ts` | new (S0) |
| `src/cli/commands/skill-search-commands.ts` | new (S0) |
| `src/cli/commands/skill-commands.ts` | minimal modify (S0) |
| `tests/unit/skill-search.test.ts` | new (S0) |
| `tests/integration/skill-search-cli.test.ts` | new (S0) |
| `skills/peaks-solo/SKILL.md` | new (S1) |
| `skills/peaks-solo/references/triage-decision-table.md` | new (S1) |
| `skills/peaks-solo/references/fallback-tool-inventory.md` | new (S1) |
| `skills/peaks-solo/references/sediment-prompt-template.md` | new (S1) |
| `tests/unit/peaks-solo.test.ts` | new (S1) |
| `.claude-plugin/marketplace.json` | modify 1 entry (S2) |
| `CHANGELOG.md` | modify 1 block (S2) |
| `README.md` | modify 1 paragraph (S2) |
| `README-en.md` | modify 1 paragraph (S2) |
| `skills/peaks-code/SKILL.md` | optional ≤ 20 字 modify (S2) |
| `tests/integration/dispatcher-flow.test.ts` | new (S3) |
| `.peaks/_runtime/<sessionId>/dogfood/dispatcher-run.log` | new (S3, gitignored) |
| `.peaks/memory/2026-07-08-peaks-solo-dogfood.md` | new (S3) |
| `package.json` | NOT modified (no new deps) |
| `src/services/**` other | NOT modified (HC-8) |

**Total: 13 new files + 4 modified files + 2 gitignored artifacts. ~1500 lines of new code + ~50 lines of modifications.**

---

## Self-review (writing-plans skill check)

1. **Spec coverage:** Spec has 6 design sections + 10 ACs. This plan maps:
   - §3.1 (SKILL.md frontmatter) → S1 deliverables + exit conditions
   - §3.2 (search CLI 草图) → S0 deliverables + API contract
   - §3.3 (triage 决策流) → S1 triage-table reference
   - §3.4 (自规划兜底) → S1 fallback-inventory reference
   - §3.5 (沉淀提议模板) → S1 sediment-prompt reference + S3 dogfood validation
   - §2.1 (In-Scope) → file map above
   - §2.2 (Out-of-Scope) → 4 NOT-modified rows in file map
   - §4 ACs → exit conditions + evidence per slice
   - §6 risks → 7+2 risks in plan index + per-slice risk tables

2. **Placeholder scan:** Searched for "TODO" / "TBD" / "fill in details" / "implement later" / "similar to" / "appropriate" / "handle edge cases". ZERO matches in this plan. All code blocks are concrete. All commands have expected output. (Confirmed: rg -n -e 'TODO|TBD|fill in|implement later|appropriate|handle edge cases' against all 4 per-slice plan files = no matches.)

3. **Type consistency:** API contracts in S0 / S1 / S2 / S3 use consistent names:
   - `searchSkills({query, tag, domain, limit})` → S0 service
   - `SkillSearchResultSchema` → S0 service, S0 unit test, S0 integration test
   - `peaks skill search` CLI surface → S0 / S2 / S3
   - `peaks-solo` skill name → S1 / S2 / S3 (consistent across all)
   - `peaks skill list` → S2 / S3 (consistent)
   - `peaks workflow verify-pipeline --rid peaks-solo-beta.5` → S3 + final acceptance (consistent)
   - `4.0.0-beta.5` → CHANGELOG + plan file naming + final commit (consistent)

**No type drift detected.** Plan is consistent with itself and with the spec.

---

## Handoff to execution

After this plan is approved, the next step is `superpowers:executing-plans` (inline) or `superpowers:subagent-driven-development` (parallel). Each slice is fan-outable within itself; the 4 slices are sequential (S0 ∥ S1 → S2 → S3).

**Default recommendation: Subagent-Driven (per writing-plans skill)** — dispatch 1 fresh subagent per slice's primary task, with two-stage review between slices.

**Inline alternative:** execute this session directly, batching slices with checkpoints. Given this is a long single session, Subagent-Driven may be more efficient (each sub-agent is short-context; main session stays at acceptable context).

**User choice required after this plan:** "Subagent-Driven (recommended) or Inline Execution?"

---

## Related

- `docs/superpowers/specs/2026-07-08-peaks-solo-dispatcher-design.md`
- `docs/superpowers/plans/2026-07-08-peaks-solo-dispatcher/index.md`
- `docs/superpowers/plans/2026-07-08-peaks-solo-dispatcher/s0-skill-search-cli.md`
- `docs/superpowers/plans/2026-07-08-peaks-solo-dispatcher/s1-peaks-solo-skill.md`
- `docs/superpowers/plans/2026-07-08-peaks-solo-dispatcher/s2-integration-and-surface.md`
- `docs/superpowers/plans/2026-07-08-peaks-solo-dispatcher/s3-dogfood.md`
- `.peaks/memory/user-decision-2026-07-08-revive-peaks-solo-as-dispatcher.md`
- `.peaks/standards/loop-engineering-guidelines.md` (RL-0..RL-9 reference; HC-11 maps to a future RL-10)
- `superpowers:writing-plans` skill (this plan follows its format)
- `superpowers:subagent-driven-development` skill (recommended for execution)
- `superpowers:executing-plans` skill (alternative for execution)
