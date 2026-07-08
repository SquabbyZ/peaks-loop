# S0 — `peaks skill search` CLI Primitive

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this slice. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **S-slice status:** Ready for implementation. Depends on: nothing. Required by: S1 (consumes `peaks skill search` capability), S2 (validates), S3 (dogfood on the search-returned-empty path).

**Spec coverage:** `docs/superpowers/specs/2026-07-08-peaks-solo-dispatcher-design.md` §3.2 (CLI 草图) + §2.1 (CLI 部分)
**Spec ACs:** AC-2, AC-3, AC-9
**Estimated effort:** 0.5 working days, single dev, full-auto (this slice is non-user-facing CLI primitive, no mode question)
**Job mode:** NO (single-rid release; S0 is a sub-deliverable, not a Job slice)

---

## Hard Constraints (inherited from spec §0)

Every scope checklist in this slice MUST include this section verbatim. **If a hard constraint is violated, the slice does not exit.**

- **HC-1 一次到位:** S0 + S1 + S2 + S3 MUST ship together in 4.0.0-beta.5. Do NOT ship S0 alone. (Reason: dispatcher without the CLI is non-functional; the plan deliberately lands all 4 in one release.)
- **HC-2 不计成本:** Do NOT degrade `peaks skill search` to `peaks skill list | grep`. Do NOT let peaks-solo reuse peaks-code's Step 0 anchor state. Do NOT skip the NOT clause in S1 description.
- **HC-3 不计时间:** Fan out S0-A / S0-B / S0-C / S0-D as 4 sub-agent tasks per the §"Sub-agent fan-out" table. Each sub-agent completes fully before the next starts.
- **HC-4 禁止假绿:** Sub-agent "完成" reports MUST include evidence: actual command output (rg / vitest / pnpm run) with raw N/N counts. No "应该是绿了" / "理论上通过".
- **HC-5 禁止偷懒:** Do NOT skip any deliverable in §"Deliverables" table below.
- **HC-6 全量回归:** S0 sign-off MUST run `pnpm vitest run` (full) + `peaks skill list` (confirms peaks-solo will appear post-S1) + check that the new `peaks skill search` exits 0.
- **HC-7 7 天 rename 红线:** Do NOT rename any peaks-* skill in this slice. S0 is CLI primitive, NOT a skill, so rename is not on the table, but verify `peaks skill search` does NOT introduce a new skill.
- **HC-8 peaks-code 0 改动:** S0 MUST NOT touch `skills/peaks-code/`, `bin/peaks.js` peaks-code surface, or peaks-code internals. Verify via `git diff --stat` after S0 sign-off.
- **HC-9 Human-NL-Choice-Only / Two-Forms-Only 兼容:** S0 is CLI primitive, not user-facing interactive. No AskUserQuestion call in this slice. (S1 will introduce AskUserQuestion.)
- **HC-10 老入口保留:** S0 MUST NOT break `peaks skill list / runbook / presence / doctor`. Verify by running all 4 before and after S0.
- **HC-11 dispatcher 比 orchestrator 薄:** S0 is a CLI primitive. S0 itself does NOT have dispatcher properties; S1 will. Do NOT make S0 "smart" (e.g., do NOT add LLM-based ranking in v1; do NOT add ML-based matching).

---

## Goal

Add a `peaks skill search` CLI primitive that returns a structured array of skill metadata (name + description + triggers + tags + domain + matchScore) given a query / tag / domain filter. This is the **分诊判断源** for `peaks-solo` (S1). Without S0, dispatcher cannot exist (S1 references S0's CLI surface in its triage decision flow per spec §3.3).

**v1 scope (this slice):** substring match on description + triggers (case-insensitive), exact match on tag / domain, AND-combinable filters, structured JSON output, empty-array on no-match (not error), `peaks skill search` with no args → error (force caller to give ≥ 1 filter to prevent "全列 + LLM 自己 grep" anti-pattern per HC-2).

**Out of v1 scope (deferred, future slice if needed):**
- Fuzzy / semantic / FTS5 matching (FTS5 deferred per existing 2026-07-07-loop-engineering M1 design note §"scenario search is LIKE-based in M1")
- Match-score re-ranking (v1 uses simple substring-hit-count as matchScore)
- Pagination (v1 returns all matches; if skill pool grows > 100 skills, add limit + paginate)
- i18n / locale (v1 is English-only)
- Caching (peaks-solo does NOT cache; v1 of `peaks skill search` also does NOT cache)

---

## Deliverables

| # | File | Action | Description |
|---|---|---|---|
| 1 | `src/services/skill/skill-search-service.ts` | create | Pure function `searchSkills({query?, tag?, domain?, limit?})` returning `SkillSearchResult[]`. Uses Zod schema for input. Reads `skills/*/SKILL.md` frontmatter (description + metadata.tags + metadata.domain). Computes `matchScore` per result. Returns `[]` on no-match. |
| 2 | `src/cli/commands/skill-search-commands.ts` | create | Commander subcommand wiring `peaks skill search` with `--query / --tag / --domain / --limit` flags. Validates input via Zod. Calls service. Outputs JSON to stdout. |
| 3 | `src/cli/commands/skill-commands.ts` | modify (minimal) | Add `search` subcommand import + register. (If `skill-commands.ts` does NOT exist or does NOT register subcommands, create it or extend the existing `src/cli/index.ts` register block.) |
| 4 | `tests/unit/skill-search.test.ts` | create | Vitest unit tests. Minimum 5 cases per §"Test cases" table. |
| 5 | `tests/integration/skill-search-cli.test.ts` | create | Vitest integration test that spawns `peaks skill search` as a child process (similar to existing `tests/integration/cli-*.test.ts` pattern) and asserts stdout JSON shape. Minimum 2 cases. |
| 6 | `docs/superpowers/specs/2026-07-08-peaks-solo-dispatcher-design.md` | **NOT modified** (spec is the upstream; S0 implements it) | — |
| 7 | `skills/peaks-code/SKILL.md` | **NOT modified** (HC-8) | — |
| 8 | `package.json` | **NOT modified** (no new deps) | — |

---

## API Contract (locked; sub-agents implement against this)

```typescript
// src/services/skill/skill-search-service.ts

import { z } from 'zod';

export const SkillSearchInputSchema = z.object({
  query: z.string().min(1).max(500).optional(),
  tag: z.string().min(1).max(100).optional(),
  domain: z.enum([
    'code', 'content', 'doctor', 'research', 'triage',
    'sop', 'audit', 'final-review', 'resume', 'status',
    'test', 'ide', 'slice-decompose', 'issue-fix-orchestrator',
    'perf-audit', 'security-audit', 'reviewer',
  ]).optional(),
  limit: z.number().int().min(1).max(100).default(20),
}).refine(
  (v) => v.query !== undefined || v.tag !== undefined || v.domain !== undefined,
  { message: 'At least one of --query / --tag / --domain is required' }
);

export type SkillSearchInput = z.infer<typeof SkillSearchInputSchema>;

export const SkillSearchResultSchema = z.object({
  name: z.string(),
  description: z.string(),
  triggers: z.array(z.string()),
  tags: z.array(z.string()),
  domain: z.string(),
  matchScore: z.number().min(0).max(1),
});

export type SkillSearchResult = z.infer<typeof SkillSearchResultSchema>;

export function searchSkills(input: SkillSearchInput): SkillSearchResult[] {
  // Implementation
}
```

**CLI surface (locked):**

```bash
peaks skill search [--query <nl-text>] [--tag <tag-string>] [--domain <code|content|doctor|research|triage|...>] [--limit <N>]
```

**Exit codes:**
- 0: success (may be empty array `[]` on no-match)
- 1: invalid args (Zod validation fail)
- 2: unexpected error (skill pool read fail, etc.)

**Output format:** JSON to stdout. Schema: `SkillSearchResult[]` (always an array, never `null`).

---

## Match rules (v1)

1. **--query substring match** (case-insensitive):
   - Search target: `description` (lowercased) + every `triggers[i]` (lowercased) concatenated with ` | ` separator
   - Match: query substring appears in target
   - `matchScore = 0.5 * (query_hits / description_length) + 0.5 * (query_hits_in_triggers / triggers_count)` clamped to [0, 1]
   - Default: any substring match qualifies; tiebreak by matchScore desc, then name asc
2. **--tag exact match:** `metadata.tags` array contains the tag string (case-insensitive)
3. **--domain exact match:** `metadata.domain` (lowercased) === `domain` (lowercased)
4. **AND combinator:** all provided filters MUST match (a result must satisfy query AND tag AND domain)
5. **All empty:** error (per Zod refine above) — force caller to give ≥ 1 filter
6. **No match:** return `[]` (not error, not null)
7. **--limit:** truncate to first N by matchScore desc; default 20

**Why substring, not FTS5:** v1 is small (20 skills, growing to 100+); substring is O(n) which is fast enough. FTS5 deferred per existing pattern. LLM-side final ranking (peaks-solo) handles the rest.

**Why empty array, not error on no-match:** dispatcher (S1) needs to differentiate "no match found" from "command failed". Error code 0 with empty array is the canonical "search succeeded, no candidates" signal.

---

## Sub-agent fan-out

Per HC-3, S0 is large enough to fan out into 4 parallel sub-agents (≥ 2 leaves at one topological level → use `peaks sub-agent dispatch --from-dag <dag-file>` per peaks-code G12 fan-out rule).

| Sub-agent | DAG node | Output | Dependency | Karpathy guidelines required |
|---|---|---|---|---|
| **S0-A** | `search-service` | `src/services/skill/skill-search-service.ts` | — | ✓ (append verbatim block from `peaks-rd/references/rd-sub-agent-dispatch.md`) |
| **S0-B** | `search-cli` | `src/cli/commands/skill-search-commands.ts` + minimal `skill-commands.ts` modify | — (parallel with S0-A) | ✓ |
| **S0-C** | `unit-tests` | `tests/unit/skill-search.test.ts` | depends on S0-A's API surface (read S0-A's `searchSkills` signature) | ✓ |
| **S0-D** | `integration-tests` | `tests/integration/skill-search-cli.test.ts` | depends on S0-B's CLI exit codes | ✓ |
| **S0-Verify** | `regression-check` | Full vitest run + `peaks skill list` verify + `peaks skill search` smoke test | depends on S0-A / S0-B / S0-C / S0-D | N/A (verifier, not implementer) |

**DAG file (write to `.peaks/_runtime/<sessionId>/sc/slice-dag.json`):**
```json
{
  "nodes": [
    { "id": "search-service", "deps": [] },
    { "id": "search-cli", "deps": [] },
    { "id": "unit-tests", "deps": ["search-service"] },
    { "id": "integration-tests", "deps": ["search-cli"] },
    { "id": "regression-check", "deps": ["search-service", "search-cli", "unit-tests", "integration-tests"] }
  ]
}
```

**Dispatch command (illustrative, will be run by main LLM):**
```bash
peaks sub-agent dispatch \
  --from-dag .peaks/_runtime/<sessionId>/sc/slice-dag.json \
  --batch-id s0-skill-search-2026-07-08
```

---

## Test cases

### Unit tests (`tests/unit/skill-search.test.ts`)

| # | Test | Input | Expected |
|---|---|---|---|
| U-1 | substring match hits description | `{query: "code"}` against a skill with `description: "Code-domain loop engineering orchestrator..."` | result contains that skill; matchScore > 0 |
| U-2 | substring match hits trigger | `{query: "全流程开发"}` against `peaks-code` (which has `triggers: [..., "全流程开发", ...]`) | result contains peaks-code; matchScore > 0 |
| U-3 | no match returns empty | `{query: "xxxxxxxxxxxxx"}` | result is `[]` |
| U-4 | tag exact match | `{tag: "code"}` | result contains only skills where `tags` includes "code" |
| U-5 | domain exact match | `{domain: "code"}` | result contains only skills where `domain === "code"` |
| U-6 | AND combinator | `{query: "code", domain: "content"}` against a skill where description matches "code" but domain is "content" | result does NOT contain that skill (contradictory) |
| U-7 | all filters empty throws | `{}` | ZodError: "At least one of --query / --tag / --domain is required" |
| U-8 | limit truncates | `{query: "e", limit: 5}` | result length ≤ 5 |
| U-9 | case-insensitive | `{query: "CODE"}` against description with "code" | result matches |
| U-10 | self-matches self | `{query: "skill"}` (if peaks-solo is in pool) | result contains peaks-solo (proves peaks-solo is self-discoverable per HC-2 spirit) |

### Integration tests (`tests/integration/skill-search-cli.test.ts`)

| # | Test | Command | Expected |
|---|---|---|---|
| I-1 | CLI exits 0 with JSON | `peaks skill search --query "code"` | exit 0; stdout is valid JSON array; array contains peaks-code |
| I-2 | CLI exits 0 with empty array on no-match | `peaks skill search --query "xxxxxxxxxxxxx"` | exit 0; stdout is `[]` |
| I-3 | CLI exits 1 on invalid args | `peaks skill search` (no filters) | exit 1; stderr contains Zod error message |
| I-4 | CLI exits 0 with tag filter | `peaks skill search --tag "code"` | exit 0; stdout JSON array; all entries have tag "code" |
| I-5 | peaks-code / peaks-content / peaks-doctor still work | (run before/after S0) `peaks skill list`; `peaks skill runbook peaks-code`; `peaks skill presence` | all exit 0; outputs unchanged (HC-10) |

---

## Evidence required for S0 sign-off (HC-4)

Sub-agent reports MUST include, not optional:

```bash
# 1. S0-A's API surface sanity (read service file's exports)
rg "export (function|const) (searchSkills|SkillSearchResultSchema|SkillSearchInputSchema)" \
   src/services/skill/skill-search-service.ts
# Expected output: 3 export hits

# 2. S0-C's unit test results
pnpm vitest run tests/unit/skill-search.test.ts
# Expected: 10/10 passed; raw output below

# 3. S0-D's integration test results
pnpm vitest run tests/integration/skill-search-cli.test.ts
# Expected: 5/5 passed; raw output below

# 4. S0-Verify full regression
pnpm vitest run
# Expected: N/N passed (N = total test count); no regression vs pre-S0 baseline

# 5. CLI smoke test
peaks skill search --query "code" | jq '.[0].name'
# Expected: "peaks-code"

# 6. HC-10 verify (peaks-code / content / doctor unchanged)
peaks skill list
peaks skill runbook peaks-code | head -5
peaks skill presence
# Expected: all 3 commands exit 0; outputs identical to pre-S0 baseline

# 7. HC-8 verify (no src/** in peaks-code touched)
git diff --stat main...HEAD -- src/
# Expected: 0 lines under skills/peaks-code/; only skill-search-service.ts + skill-search-commands.ts + tests/* added
```

**If any evidence item is missing, the slice does not exit. Sub-agent must re-run, not declare "完成".**

---

## Exit conditions

S0 exits successfully only when ALL of the following are true:

- [ ] `src/services/skill/skill-search-service.ts` exists; exports `searchSkills / SkillSearchResultSchema / SkillSearchInputSchema` per API Contract
- [ ] `src/cli/commands/skill-search-commands.ts` exists; registers `peaks skill search` per CLI surface
- [ ] `tests/unit/skill-search.test.ts` exists; 10/10 unit cases pass
- [ ] `tests/integration/skill-search-cli.test.ts` exists; 5/5 integration cases pass
- [ ] Full `pnpm vitest run` green; no regression
- [ ] `peaks skill list` output identical to pre-S0 baseline
- [ ] `peaks skill runbook peaks-code` output identical to pre-S0 baseline
- [ ] `peaks skill presence` output identical to pre-S0 baseline
- [ ] `git diff --stat main...HEAD -- src/` shows 0 lines under `skills/peaks-code/`
- [ ] All 7 evidence items above present in sub-agent report

**If any box is unchecked, S0 is BLOCKED. Do NOT proceed to S1.**

---

## Risks (inherited from plan index §Risks; S0-specific annotations)

| # | Risk | Severity | S0-specific mitigation |
|---|---|---|---|
| R1 | `peaks skill search` performance | Medium | S0 unit tests include a synthetic 100-skill pool; if `searchSkills` takes > 50ms for 100 skills, file a v2 follow-up. (v1 is acceptable at 100ms.) |
| R6 | CHANGELOG 措辞 user freeze 卡住 S2 | Low | Not applicable to S0 (S0 is CLI, not user-facing surface). Carry over to S2. |
| R7 | peaks-loop 自己 dogfood 时找不到 deep-search skill | Low | Not applicable to S0. Carry over to S3. |
| **R8** (new) | Skill pool read fail: what if `skills/*/SKILL.md` is malformed? | Medium | S0-A's service MUST catch parse errors per file and skip the file (not fail the whole search). Log warning to stderr. Add U-11 test case: mock a malformed SKILL.md in temp dir, verify search returns remaining skills + stderr warning. |
| **R9** (new) | Skill pool read fail: what if `skills/` directory does not exist (e.g., when peaks is installed via npm in a downstream project)? | Low | S0-A's service MUST return `[]` if `skills/` directory does not exist, with stderr note "skill pool not found in this context". Add U-12 test case. |

---

## Self-check (Karpathy #4 Goal-Driven Execution)

- **Goal:** S0 = dispatcher 的"分诊判断源"基础。Without S0, S1 / S2 / S3 cannot function.
- **Simplicity:** 1 service file + 1 CLI file + 2 test files. No new deps. No DB. No async I/O. Pure sync.
- **Surgical:** Does NOT touch peaks-code. Does NOT introduce LLM-side ranking. Does NOT add caching.
- **Goal-driven:** Each test case maps to a spec AC (U-1..U-3, U-9..U-10 → AC-2; U-3 → AC-3; U-7 → CLI input validation; I-1, I-2 → AC-2, AC-3 from integration perspective; full vitest → AC-9).

---

## Related

- `docs/superpowers/specs/2026-07-08-peaks-solo-dispatcher-design.md` §3.2 (CLI 草图) + §2.1 (CLI 部分) + §6 R1 (performance risk)
- `docs/superpowers/plans/2026-07-08-peaks-solo-dispatcher/index.md` §Hard Constraints + §Slice Map + §Parallelism + §File Structure + §Risks
- `src/services/skill/` (existing skill service directory) — S0-A creates `skill-search-service.ts` here, following existing naming
- `src/cli/commands/` (existing CLI commands directory) — S0-B creates `skill-search-commands.ts` here
- `tests/unit/skill/` (existing test directory, may not exist yet) — S0-C creates test file here, mirror existing layout
- `tests/integration/cli-*.test.ts` (existing pattern) — S0-D mirrors
- `package.json` `packageManager: pnpm@10.11.0` — use `pnpm` (not `npm`)
- `.peaks/memory/user-decision-2026-07-08-revive-peaks-solo-as-dispatcher.md` — 商讨结论 + HC-1..HC-11 来源
