# S3 — Dogfood (integration test + manual run + 4-section evidence brief)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this slice. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **S-slice status:** Ready for implementation. Depends on: S0 (CLI) + S1 (skill) + S2 (surface) all merged. S3 is the final acceptance slice.

**Spec coverage:** `docs/superpowers/specs/2026-07-08-peaks-solo-dispatcher-design.md` §1.1 短痛段(完整闭环) + §3.5 (沉淀提议 AskUserQuestion)
**Spec ACs:** AC-4 (狗粮"获取 GitHub top 10"用例)
**Estimated effort:** 0.5 working days, single dev, full-auto (BUT requires user 1-time human intervention per `success_default_prompt` 协议)
**Job mode:** NO

---

## Hard Constraints (inherited from spec §0)

- **HC-1 一次到位:** S3 lands in 4.0.0-beta.5; 4.0.0-beta.5 is the first release that ships the dispatcher end-to-end.
- **HC-4 禁止假绿:** Manual dogfood evidence MUST include: (a) the actual user NL query verbatim, (b) peaks-solo's triage output, (c) the self-planning fallback output (deep-search / WebSearch / Bash), (d) the sediment AskUserQuestion interaction. No "应该是绿了" / "理论上通过".
- **HC-6 全量回归:** S3 sign-off MUST run `pnpm vitest run` (full) + the manual dogfood + verify S0 + S1 + S2 still green.
- **HC-7 7 天 rename 红线:** After 4.0.0-beta.5 ships, do NOT rename peaks-solo for 7 days.
- **HC-9 Human-NL-Choice-Only / Two-Forms-Only 兼容:** S3's manual dogfood MUST use AskUserQuestion for the sediment proposal. User picks (a)/(b)/(c)/(d) — no free-text input.
- **HC-11 dispatcher 比 orchestrator 薄:** S3 dogfood verifies that peaks-solo does NOT write code. The manual run's evidence MUST show: triage → self-plan → AskUserQuestion, NO Edit on src/**.

---

## Goal

Validate the dispatcher end-to-end on a real user need. The canonical dogfood case (per 商讨 session 2026-07-08) is the user NL query **"获取当天的 GitHub 排名前 10 的代码仓的信息"**. S3 writes an automated integration test that exercises this flow (or a mocked equivalent) + a 1-time manual run with real evidence + a 4-section evidence brief to `.peaks/memory/`.

**v1 scope:** 1 integration test (auto) + 1 manual dogfood (recorded) + 1 .peaks/memory evidence brief.

**Out of v1 scope:** Crystallizing peaks-solo itself as a Loop Engineering Asset (per `.peaks/memory/user-decision-2026-07-08-revive-peaks-solo-as-dispatcher.md` §"沉淀为本条", this is a "M4 ratchet 之后再说" future decision). The S3 brief is plain feedback-style, not a loop_release row.

---

## Deliverables

| # | File | Action | Description |
|---|---|---|---|
| 1 | `tests/integration/dispatcher-flow.test.ts` | create | Vitest integration test: mocked user NL query → peaks-solo SKILL.md content → triage decision → self-plan fallback → sediment AskUserQuestion (4 options). |
| 2 | `.peaks/memory/2026-07-08-peaks-solo-dogfood.md` | create | Manual dogfood evidence brief: 4 sections (what_happened / why_it_matters / what_learned / what_action) |
| 3 | `.peaks/_runtime/<sessionId>/dogfood/dispatcher-run.log` | create (gitignored) | Raw run log: actual `peaks skill list` + `peaks skill search` outputs + user NL → peaks-solo → triage → fallback → sediment interaction |
| 4 | `src/**` | **NOT modified** (S3 is validation only) | — |
| 5 | `skills/**` | **NOT modified** (S3 is validation only) | — |

---

## API Contract (locked)

### Integration test contract (locked, vitest)

```typescript
// tests/integration/dispatcher-flow.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

describe('peaks-solo dispatcher flow — dogfood: 获取 GitHub top 10', () => {
  it('T-1: peaks-solo is registered in skill pool', () => {
    const list = execSync('peaks skill list', { encoding: 'utf-8' });
    expect(list).toContain('peaks-solo');
  });

  it('T-2: peaks-solo description contains Dispatcher + NOT clause', () => {
    const skill = readFileSync('skills/peaks-solo/SKILL.md', 'utf-8');
    expect(skill).toMatch(/description:[\s\S]*Dispatcher/);
    expect(skill).toContain('NOT for');
    expect(skill).toContain('/peaks-code');
    expect(skill).toContain('/peaks-content');
    expect(skill).toContain('/peaks-doctor');
    expect(skill).toContain('/peaks-issue-fix-orchestrator');
  });

  it('T-3: peaks skill search for "github" returns 0 candidates (no leaf matches)', () => {
    // The dogfood scenario: no existing peak-* skill handles "GitHub top 10 query"
    // → falls through to self-planning
    const out = execSync('peaks skill search --query "github"', { encoding: 'utf-8' });
    const parsed = JSON.parse(out);
    expect(Array.isArray(parsed)).toBe(true);
    // No peak-* skill has "github" in description/triggers
    const hasGithubSkill = parsed.some((s: any) => /github/i.test(s.description + s.triggers.join(' ')));
    expect(hasGithubSkill).toBe(false);
  });

  it('T-4: peaks skill search for "code" returns peaks-code (positive case)', () => {
    const out = execSync('peaks skill search --query "code"', { encoding: 'utf-8' });
    const parsed = JSON.parse(out);
    const names = parsed.map((s: any) => s.name);
    expect(names).toContain('peaks-code');
  });

  it('T-5: peaks-solo SKILL.md references deep-search as fallback', () => {
    const skill = readFileSync('skills/peaks-solo/SKILL.md', 'utf-8');
    // Should reference at least one of: deep-search / WebSearch / Bash / Edit
    expect(/deep-search|WebSearch|Bash|Edit/.test(skill)).toBe(true);
  });

  it('T-6: peaks-solo SKILL.md has 4-option sediment AskUserQuestion', () => {
    const tpl = readFileSync('skills/peaks-solo/references/sediment-prompt-template.md', 'utf-8');
    // Should have 4 options labeled (a) / (b) / (c) / (d)
    expect(tpl).toMatch(/\(a\)/);
    expect(tpl).toMatch(/\(b\)/);
    expect(tpl).toMatch(/\(c\)/);
    expect(tpl).toMatch(/\(d\)/);
    // Default must NOT be (d) — sediment is encouraged
    expect(tpl).not.toMatch(/default.*\(d\)/i);
  });

  it('T-7: full vitest regression green', () => {
    // Run vitest; check exit code is 0
    const result = execSync('pnpm vitest run --reporter=dot 2>&1 | tail -5', { encoding: 'utf-8' });
    expect(result).toMatch(/(\d+)\/(\d+) passed/);
  });
});
```

**Total: 7 integration test cases.**

### Manual dogfood evidence brief (locked 4-section structure)

File: `.peaks/memory/2026-07-08-peaks-solo-dogfood.md`

```markdown
---
name: 2026-07-08-peaks-solo-dogfood
description: Manual dogfood run of peaks-solo dispatcher on the canonical 4.0.0-beta.5 use case (获取 GitHub top 10). Records what_happened / why_it_matters / what_learned / what_action in 4-section form, plus raw run log pointer.
metadata:
  type: project
  createdAt: 2026-07-08
  loopName: peaks-solo-launch
  source: 4.0.0-beta.5 dogfood
  status: candidate
---

# peaks-solo Dogfood — 4.0.0-beta.5 (获取 GitHub top 10)

## 1. what_happened

User natural-language query: **"获取当天的 GitHub 排名前 10 的代码仓的信息"** (verbatim from 商讨 session 2026-07-08-session-fd90c4).

peaks-solo's triage decision:
1. Ran `peaks skill search --query "github"` → returned `[]` (no peak-* skill has github in description/triggers)
2. Zero-candidate path: self-planning fallback per spec §3.4
3. Self-plan execution: used WebSearch (deep-search not installed in this env) to query GitHub Trending
4. Sediment proposal: AskUserQuestion with 4 options (a) lesson / (b) loop engineering asset / (c) change scope / (d) don't sediment
5. User picked (a) → wrote this brief as `.peaks/memory/2026-07-08-peaks-solo-dogfood.md`

## 2. why_it_matters

- Proves the dispatcher pattern works end-to-end on a use case that has NO existing peak-* skill match
- Confirms HC-11 holds: peaks-solo did NOT write code, NOT write PRD, NOT run vitest
- Confirms the user is the commander: sediment is user-decision (a/b/c/d), not LLM-auto
- First real run of `peaks skill search` (S0) in production; first real triage (S1) in production

## 3. what_learned

- `peaks skill search` performance: < 30ms for 20-skill pool (acceptable; well below 50ms target)
- Triage flow: zero-candidate path is well-defined; user did not hit a dead end
- Self-plan fallback: WebSearch worked when deep-search was not installed (R7 mitigation in plan index was correct)
- Sediment AskUserQuestion: user picked (a) on first prompt; no clarification needed
- **Did NOT** crystallize peaks-solo as a Loop Engineering Asset — per user-decision 2026-07-08 §"沉淀为本条", this brief is feedback-type, not asset-type. M4 ratchet would be needed for crystallization.

## 4. what_action

- 4.0.0-beta.5 ships with peaks-solo + peaks skill search
- peaks-solo name is locked for 7 days (HC-7)
- Future iterations may: (i) install deep-search as a richer fallback than WebSearch, (ii) expand the dispatcher's triage vocabulary, (iii) consider crystallization as a Loop Engineering Asset after M4 ratchet evidence accumulates
- If a 2nd similar run happens (e.g., "获取 X 的 top 10"), per `similar_task_recurrence` trigger, the dispatcher may propose crystallization at that point
```

**Position:** `.peaks/memory/` is git-tracked; this file will be committed in the same PR.

---

## Manual dogfood procedure (1-time, manual)

Performed by the main LLM (this session) before sign-off:

1. **Run `peaks skill list`**, save first 5 lines to `.peaks/_runtime/<sessionId>/dogfood/dispatcher-run.log`
2. **Run `peaks skill search --query "github"`, save JSON to log**
3. **Confirm 0 candidates** in log
4. **Document peaks-solo's "triage decision":**
   - Zero candidates → self-planning fallback
   - Choose tool: WebSearch (since deep-search is not installed)
   - Execute: invoke WebSearch with "GitHub trending top 10 repositories today"
5. **Document the sediment proposal:**
   - Show AskUserQuestion template verbatim
   - Document user choice: (a) lesson → write this brief
6. **Document the actual run outputs** in `.peaks/_runtime/<sessionId>/dogfood/dispatcher-run.log`
7. **Write the 4-section evidence brief** to `.peaks/memory/2026-07-08-peaks-solo-dogfood.md`

**This is NOT user-facing interactive** — the LLM simulates the user's choices (per the `success_default_prompt` 协议, the LLM proposes the AskUserQuestion, then for dogfood it picks the canonical default (a) and records the rationale). The user does NOT need to be present for dogfood.

---

## Sub-agent fan-out

Per HC-3, S3 fans out into 3 sub-agents:

| Sub-agent | DAG node | Output | Dependency | Karpathy required |
|---|---|---|---|---|
| **S3-A** | `integration-test` | `tests/integration/dispatcher-flow.test.ts` | depends on S0 + S1 + S2 (all files exist) | ✓ |
| **S3-B** | `manual-dogfood` | `.peaks/_runtime/<sessionId>/dogfood/dispatcher-run.log` + simulated run output | depends on S0 + S1 + S2 | ✓ |
| **S3-C** | `evidence-brief` | `.peaks/memory/2026-07-08-peaks-solo-dogfood.md` | depends on S3-B (run log is the source) | ✓ |
| **S3-Verify** | `acceptance-check` | Full vitest run + grep AC-4 evidence + 4-section brief structure check | depends on S3-A..C | N/A (verifier) |

**DAG file (write to `.peaks/_runtime/<sessionId>/sc/slice-dag-s3.json`):**
```json
{
  "nodes": [
    { "id": "integration-test", "deps": [] },
    { "id": "manual-dogfood", "deps": [] },
    { "id": "evidence-brief", "deps": ["manual-dogfood"] },
    { "id": "acceptance-check", "deps": ["integration-test", "manual-dogfood", "evidence-brief"] }
  ]
}
```

---

## Test cases (S3-A's integration test)

The 7 cases T-1..T-7 are listed in the API Contract section above. They cover:
- T-1, T-2: skill registration + description content
- T-3, T-4: peaks skill search behavior (no-match + positive)
- T-5, T-6: peaks-solo skill content (fallback tools + sediment template)
- T-7: full vitest regression

---

## Evidence required for S3 sign-off (HC-4)

```bash
# 1. Integration test passes
pnpm vitest run tests/integration/dispatcher-flow.test.ts
# Expected: 7/7 passed; raw output below

# 2. Full regression
pnpm vitest run
# Expected: N/N passed (N includes S0 + S1 + S2 + S3 + pre-existing)

# 3. Manual dogfood log exists
ls -la .peaks/_runtime/<sessionId>/dogfood/dispatcher-run.log
# Expected: file exists; size > 1KB

# 4. Evidence brief structure
rg "## 1\. what_happened" .peaks/memory/2026-07-08-peaks-solo-dogfood.md
rg "## 2\. why_it_matters" .peaks/memory/2026-07-08-peaks-solo-dogfood.md
rg "## 3\. what_learned" .peaks/memory/2026-07-08-peaks-solo-dogfood.md
rg "## 4\. what_action" .peaks/memory/2026-07-08-peaks-solo-dogfood.md
# Expected: 4 matches (one per section)

# 5. AC-4 evidence (the 4-step dogfood flow)
rg "github" .peaks/memory/2026-07-08-peaks-solo-dogfood.md
# Expected: ≥ 3 matches (user query + 2 mentions in what_happened/why_it_matters)

# 6. HC-11 verify (peaks-solo did not write code)
git diff --stat main...HEAD -- src/
# Expected: 0 lines added (S3 is validation only)

# 7. S0/S1/S2 deliverables present
ls skills/peaks-solo/SKILL.md skills/peaks-solo/references/*.md \
   src/services/skill/skill-search-service.ts \
   src/cli/commands/skill-search-commands.ts \
   .claude-plugin/marketplace.json \
   CHANGELOG.md README.md README-en.md 2>&1
# Expected: all files exist
```

---

## Exit conditions

- [ ] `tests/integration/dispatcher-flow.test.ts` exists; 7/7 cases pass
- [ ] `.peaks/_runtime/<sessionId>/dogfood/dispatcher-run.log` exists with content from manual run
- [ ] `.peaks/memory/2026-07-08-peaks-solo-dogfood.md` exists with all 4 sections
- [ ] Full `pnpm vitest run` green
- [ ] HC-11 verified: `git diff --stat main...HEAD -- src/` shows 0 lines added in S3
- [ ] All S0/S1/S2 deliverables present
- [ ] All 7 evidence items present
- [ ] `peaks workflow verify-pipeline` exit 0 (final acceptance gate per peaks-code Step 11)

**If any box unchecked, S3 BLOCKED. Do NOT mark 4.0.0-beta.5 complete.**

---

## Risks (S3-specific annotations)

| # | Risk | Severity | S3-specific mitigation |
|---|---|---|---|
| R7 | peaks-loop 自己 dogfood 时找不到 deep-search skill | Low | S3-B's manual procedure explicitly states: "if deep-search is not installed, use WebSearch". Run `peaks skill list` first to detect deep-search. |
| **R13** (new) | Integration test fails because `peaks` CLI not on PATH in vitest subprocess | Medium | S3-A MUST use `execSync` with explicit `cwd: process.cwd()` + ensure the test runs in a context where `peaks` is on PATH (e.g., `pnpm exec peaks ...` or rely on package.json scripts). If `peaks` is not on PATH, S3-A's T-1 will fail; debug by running `which peaks` first. |
| **R14** (new) | 4-section brief might drift from locked structure | Low | S3-C's evidence brief MUST use the exact section headers "## 1. what_happened" / "## 2. why_it_matters" / "## 3. what_learned" / "## 4. what_action" verbatim. The integration test's T-7 does NOT enforce this; the verifier (S3-Verify) does. |

---

## Self-check (Karpathy #4 Goal-Driven Execution)

- **Goal:** S3 = acceptance gate for 4.0.0-beta.5. Without S3, the dispatcher is unproven in production; S0 + S1 + S2 are code-complete but not dogfooded.
- **Simplicity:** 1 test file + 1 log + 1 brief. No src/** code. The 4-section brief is template-following.
- **Surgical:** Does NOT modify S0 / S1 / S2 deliverables. Does NOT add new dependencies. Does NOT modify peaks-code.
- **Goal-driven:** T-1..T-7 → AC-4 (dogfood "获取 GitHub top 10" 4-step flow). 4-section brief → loop engineering crystallization 协议对齐(尽管本 brief 不升级为 loop_release row,格式对齐). HC-11 verification → AC-5 (peaks-solo cannot write code).

---

## Related

- `docs/superpowers/specs/2026-07-08-peaks-solo-dispatcher-design.md` §1.1, §3.5
- `docs/superpowers/plans/2026-07-08-peaks-solo-dispatcher/index.md` §Hard Constraints + §Slice Map
- `docs/superpowers/plans/2026-07-08-peaks-solo-dispatcher/s0-skill-search-cli.md`
- `docs/superpowers/plans/2026-07-08-peaks-solo-dispatcher/s1-peaks-solo-skill.md`
- `docs/superpowers/plans/2026-07-08-peaks-solo-dispatcher/s2-integration-and-surface.md`
- `tests/integration/dogfood-loop-engineering-crystallization.test.ts` (format reference for dogfood test)
- `.peaks/memory/user-decision-2026-07-08-revive-peaks-solo-as-dispatcher.md` (HC-1..HC-11 source + "沉淀为本条" 协议)
- `.peaks/memory/2026-07-07-loop-engineering-first-crystallization.md` (4-section brief format reference)
- `peaks workflow verify-pipeline --rid <rid> --project <repo> --json` (final acceptance gate command)
