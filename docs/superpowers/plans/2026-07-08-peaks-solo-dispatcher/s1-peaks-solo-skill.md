# S1 — `peaks-solo` Dispatcher Skill

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this slice. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **S-slice status:** Ready for implementation. Depends on: S0 (peaks skill search CLI) must be merged first; S1 reads `peaks skill search` output to make triage decisions. Required by: S2 (marketplace.json entry), S3 (dogfood consumes S1).

**Spec coverage:** `docs/superpowers/specs/2026-07-08-peaks-solo-dispatcher-design.md` §3.1 (SKILL.md frontmatter) + §3.3 (triage decision flow) + §3.4 (自规划兜底) + §3.5 (沉淀提议模板) + §2.1 (skill 部分)
**Spec ACs:** AC-1, AC-5
**Estimated effort:** 0.5 working days, single dev, full-auto
**Job mode:** NO

---

## Hard Constraints (inherited from spec §0)

- **HC-1 一次到位:** S1 MUST ship with S0 + S2 + S3 in 4.0.0-beta.5.
- **HC-2 不计成本:** Do NOT let `peaks-solo` reuse peaks-code's Step 0 anchor state (each skill has its own anchor). Do NOT skip the NOT clause.
- **HC-4 禁止假绿:** Sub-agent reports MUST include raw `peaks skill list` output showing peaks-solo present.
- **HC-6 全量回归:** S1 sign-off MUST run `pnpm vitest run` + `peaks skill list` + `peaks skill list | grep peaks-solo`.
- **HC-7 7 天 rename 红线:** S1 introduces the name `peaks-solo`. After this slice lands, do NOT rename `peaks-solo` for 7 days.
- **HC-8 peaks-code 0 改动:** S1 MUST NOT touch `skills/peaks-code/`. **Optional:** S2 may add 1 sentence to peaks-code's SKILL.md description (≤ 20 字, "如不想自己选 / 用 /peaks-solo"); S1 does NOT do this.
- **HC-9 Human-NL-Choice-Only / Two-Forms-Only 兼容:** S1's SKILL.md MUST include AskUserQuestion templates for (a) triage multi-match, (b) sediment proposal. No free-text input.
- **HC-11 dispatcher 比 orchestrator 薄:** S1's SKILL.md MUST explicitly list "Out of scope": no code writing, no PRD writing, no vitest running, no Loop Engineering Asset mutation. Allowed: query skill pool, dispatch to leaf, run generic tools (deep-search / WebSearch / Bash / Edit markdown), propose sediment.

---

## Goal

Create the `peaks-solo` dispatcher skill: a single SKILL.md + 3 reference files + 1 test file. After S1 ships, `peaks skill list` shows peaks-solo with a "Dispatcher" description, NOT clause explicitly excluding code/content/doctor/issue-fix-orchestrator work, and a documented triage decision flow that uses `peaks skill search` (S0) as its lookup primitive.

**v1 scope (this slice):** SKILL.md + 3 references + unit test for frontmatter parsing. **NOT in v1:** runtime skill execution (the LLM reads SKILL.md and follows the documented flow; no programmatic dispatcher).

---

## Deliverables

| # | File | Action | Description |
|---|---|---|---|
| 1 | `skills/peaks-solo/SKILL.md` | create | Frontmatter (name + description with NOT clause + metadata) + 6 sections (角色定义 / 触发条件 / triage 决策表 / 自规划兜底 / 沉淀提议 / Out of scope) |
| 2 | `skills/peaks-solo/references/triage-decision-table.md` | create | Keyword → leaf skill mapping table (case-insensitive; ≥ 10 entries) |
| 3 | `skills/peaks-solo/references/fallback-tool-inventory.md` | create | Self-planning tool inventory (deep-search / WebSearch / Bash / Edit markdown) with allowed/blocked lists |
| 4 | `skills/peaks-solo/references/sediment-prompt-template.md` | create | AskUserQuestion template for sediment proposal (4 options + recommended default) |
| 5 | `tests/unit/peaks-solo.test.ts` | create | Unit test: frontmatter parse + NOT clause parse + trigger phrase presence |
| 6 | `skills/peaks-code/SKILL.md` | **NOT modified** (HC-8; S2 will optionally add 1 sentence) | — |
| 7 | `package.json` | **NOT modified** (no new deps) | — |

---

## API Contract (locked)

### SKILL.md frontmatter (locked structure)

```yaml
---
name: peaks-solo
description: |
  [verbatim description — see below]
metadata:
  type: dispatcher
  domain: triage
  visibility: public
  red_lines: [RL-1, RL-8, HC-7, HC-8, HC-9, HC-10, HC-11]
---
```

### description (locked verbatim, ≤ 1024 chars)

```yaml
description: |
  Dispatcher (分诊员) for the Peaks-Loop skill family. Use when the user describes a task in natural language and does NOT know which peaks-* skill fits. peaks-solo reads the live skill pool via `peaks skill search`, dispatches to a matching leaf (peaks-code / peaks-content / peaks-doctor / peaks-issue-fix-orchestrator / etc.) or falls back to self-planned execution (deep-search / WebSearch / Bash / Edit markdown) if no leaf matches, and then asks the user whether to sediment the result.

  Triggers: 自然语言描述诉求且无明确 peaks-* skill 选择 / "帮我处理这个" / "我不知道该用哪个" / "随便都行".

  NOT for: code-specific work (use /peaks-code) / content-specific work (use /peaks-content) / project health check (use /peaks-doctor) / issue sweep (use /peaks-issue-fix-orchestrator) / SOP authoring (use /peaks-sop).
```

### SKILL.md body (6 sections, locked ordering)

1. **§1 角色定义** (dispatcher ≠ orchestrator; HC-11 引用)
2. **§2 触发条件** (3 类匹配: source-trace / trigger-phrase / LLM-judge)
3. **§3 Triage 决策流** (pseudo-code for peaks skill search + multi-match AskUserQuestion; cite `peaks-skill-search.md` 草图 from spec §3.2)
4. **§4 自规划兜底** (allowed tools table from references/fallback-tool-inventory.md)
5. **§5 沉淀提议** (AskUserQuestion template, cite references/sediment-prompt-template.md)
6. **§6 Out of scope** (HC-11 enforcement: no code / no PRD / no vitest / no Loop Engineering Asset mutation)

---

## Match rules (v1)

| Triage class | Decision |
|---|---|
| 0 candidates (skill search returns `[]`) | Self-planning fallback (§4) |
| 1 candidate | Direct dispatch (Skill tool call) |
| ≥ 2 candidates | AskUserQuestion multi-choice; user picks 1; if user picks "(e) 都不对", self-planning fallback |
| User explicitly says "I want to do this manually" or "我自己来" | Bail out (return control to user) |

**Trigger phrase priority (locked, for `peaks-solo` description frontmatter):**

```
"自然语言描述诉求且无明确 peaks-* skill 选择" — primary
"帮我处理这个" / "我不知道该用哪个" / "随便都行" — secondary (NL variants)
```

---

## Sub-agent fan-out

Per HC-3, S1 fans out into 5 parallel sub-agents:

| Sub-agent | DAG node | Output | Dependency | Karpathy required |
|---|---|---|---|---|
| **S1-A** | `skill-md` | `skills/peaks-solo/SKILL.md` | — | ✓ |
| **S1-B** | `triage-table` | `skills/peaks-solo/references/triage-decision-table.md` | depends on S1-A's §3 cross-ref | ✓ |
| **S1-C** | `fallback-inv` | `skills/peaks-solo/references/fallback-tool-inventory.md` | — (parallel with S1-B) | ✓ |
| **S1-D** | `sediment-tpl` | `skills/peaks-solo/references/sediment-prompt-template.md` | — (parallel with S1-B/C) | ✓ |
| **S1-E** | `unit-tests` | `tests/unit/peaks-solo.test.ts` | depends on S1-A's frontmatter verbatim | ✓ |
| **S1-Verify** | `regression-check` | vitest + `peaks skill list` + dispatch smoke | depends on S1-A..E | N/A (verifier) |

**DAG file (write to `.peaks/_runtime/<sessionId>/sc/slice-dag-s1.json`):**
```json
{
  "nodes": [
    { "id": "skill-md", "deps": [] },
    { "id": "triage-table", "deps": ["skill-md"] },
    { "id": "fallback-inv", "deps": [] },
    { "id": "sediment-tpl", "deps": [] },
    { "id": "unit-tests", "deps": ["skill-md"] },
    { "id": "regression-check", "deps": ["skill-md", "triage-table", "fallback-inv", "sediment-tpl", "unit-tests"] }
  ]
}
```

---

## Test cases (`tests/unit/peaks-solo.test.ts`)

| # | Test | Input | Expected |
|---|---|---|---|
| U-1 | frontmatter parses | read `skills/peaks-solo/SKILL.md` | `name === "peaks-solo"`; `description` contains "Dispatcher"; `metadata.type === "dispatcher"` |
| U-2 | NOT clause present | read SKILL.md description | description contains "NOT for"; contains all of "/peaks-code", "/peaks-content", "/peaks-doctor", "/peaks-issue-fix-orchestrator", "/peaks-sop" |
| U-3 | trigger phrase present | read SKILL.md description | contains "自然语言描述诉求"; contains "帮我处理这个" |
| U-4 | Out of scope section exists | read SKILL.md body | contains `## 6. Out of scope` (or equivalent); contains "no code"; contains "no PRD"; contains "no vitest"; contains "no Loop Engineering Asset" |
| U-5 | triage decision table file exists | read `references/triage-decision-table.md` | file exists; contains ≥ 10 keyword rows; contains columns "keyword" + "→" + leaf skill name |
| U-6 | fallback tool inventory file exists | read `references/fallback-tool-inventory.md` | file exists; lists ≥ 3 allowed tools; lists ≥ 1 blocked tool |
| U-7 | sediment prompt template file exists | read `references/sediment-prompt-template.md` | file exists; contains 4 options (a/b/c/d); default is (a) or (b) NOT (d) |

**Total: 7 unit cases minimum.**

---

## Evidence required for S1 sign-off (HC-4)

```bash
# 1. peaks-solo appears in skill list
peaks skill list | grep peaks-solo
# Expected: at least 1 line containing "peaks-solo"

# 2. Description contains "Dispatcher"
peaks skill list | grep -A 1 "peaks-solo" | head -2
# Expected: description line contains "Dispatcher"

# 3. Unit tests pass
pnpm vitest run tests/unit/peaks-solo.test.ts
# Expected: 7/7 passed; raw output below

# 4. Full regression (S0 still green + S1 green)
pnpm vitest run
# Expected: N/N passed (N includes S0 + S1 + pre-existing); no regression

# 5. HC-8 verify (peaks-code untouched)
git diff --stat main...HEAD -- skills/peaks-code/
# Expected: 0 lines (S1 does not modify peaks-code)

# 6. HC-7 verify (no rename)
git log --oneline -1 -- skills/peaks-solo/
# Expected: 1 commit creating skills/peaks-solo/; NOT a rename of another skill
```

---

## Exit conditions

- [ ] `skills/peaks-solo/SKILL.md` exists with locked frontmatter (name + description with NOT clause + metadata)
- [ ] `skills/peaks-solo/references/triage-decision-table.md` exists with ≥ 10 keyword rows
- [ ] `skills/peaks-solo/references/fallback-tool-inventory.md` exists with allowed + blocked tools
- [ ] `skills/peaks-solo/references/sediment-prompt-template.md` exists with 4-option AskUserQuestion
- [ ] `tests/unit/peaks-solo.test.ts` exists; 7/7 cases pass
- [ ] Full `pnpm vitest run` green
- [ ] `peaks skill list` shows `peaks-solo` with "Dispatcher" in description
- [ ] HC-8 verified: `git diff --stat main...HEAD -- skills/peaks-code/` shows 0 lines
- [ ] All 6 evidence items present

**If any box unchecked, S1 BLOCKED. Do NOT proceed to S2.**

---

## Risks (S1-specific annotations)

| # | Risk | Severity | S1-specific mitigation |
|---|---|---|---|
| R2 | dispatcher 分诊错 | High | S1-B's triage table MUST include ≥ 10 keywords covering common tasks; S1-A's §3 MUST include the ≥ 2 candidate AskUserQuestion flow with "(e) 都不对" option; S3 dogfood will verify in practice |
| R3 | 自规划兜底无 boundary | High | S1-C's fallback inventory MUST list ≥ 1 blocked tool (e.g., `rm -rf` / `git push --force` / editing `skills/peaks-{code,content,...}/*`); S1-A's §6 MUST enumerate HC-11 violations |
| R4 | 与 leaf 描述重叠 | Medium | S1-A's description MUST contain explicit NOT clause for /peaks-code, /peaks-content, /peaks-doctor, /peaks-issue-fix-orchestrator, /peaks-sop; S2 will add a 1-sentence pointer to peaks-code's own description |
| **R10** (new) | SKILL.md frontmatter NOT clause 维护负担 | Low | S1-A's frontmatter MUST contain exactly 5 NOT entries (not exhaustive list; dispatcher is opportunistic). S2/S3 may add more if observed in dogfood |

---

## Self-check (Karpathy #4 Goal-Driven Execution)

- **Goal:** S1 = dispatcher skill 本身. Without S1, peaks-solo doesn't exist; S2 marketplace entry has no target; S3 dogfood has no skill to dogfood on.
- **Simplicity:** 1 SKILL.md + 3 references + 1 test. No src/** code (dispatcher is a pure-skill LLM behavior, not a CLI/program).
- **Surgical:** Does NOT touch peaks-code. Does NOT add new dependencies. Does NOT modify existing peaks-* skills' descriptions.
- **Goal-driven:** U-1, U-2, U-3, U-4 → AC-1 (peaks-solo appears with Dispatcher description). U-2's NOT clause → AC-5 (peaks-solo cannot write code: explicit gate). U-5..U-7 → dispatcher behavior foundation. Full vitest → AC-9.

---

## Related

- `docs/superpowers/specs/2026-07-08-peaks-solo-dispatcher-design.md` §3.1, §3.3, §3.4, §3.5
- `docs/superpowers/plans/2026-07-08-peaks-solo-dispatcher/index.md` §Hard Constraints + §Slice Map + §Parallelism
- `docs/superpowers/plans/2026-07-08-peaks-solo-dispatcher/s0-skill-search-cli.md` (S1 depends on S0)
- `skills/peaks-sop/SKILL.md` (S1 follows this same frontmatter pattern, but with dispatcher-specific description)
- `skills/peaks-code/SKILL.md` (HC-8 — DO NOT modify)
- `.peaks/memory/user-decision-2026-07-08-revive-peaks-solo-as-dispatcher.md` (HC-1..HC-11 source)
