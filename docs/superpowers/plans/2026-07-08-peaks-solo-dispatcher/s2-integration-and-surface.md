# S2 — Integration & Surface (marketplace.json + CHANGELOG + README)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this slice. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **S-slice status:** Ready for implementation. Depends on: S0 (CLI primitive) + S1 (skill) must be merged first. Required by: S3 (dogfood).

**Spec coverage:** `docs/superpowers/specs/2026-07-08-peaks-solo-dispatcher-design.md` §2.1 (CHANGELOG / marketplace / README 部分) + §1.1 (CHANGELOG 措辞 "用户 freeze")
**Spec ACs:** AC-7 (老入口保留 = CHANGELOG 不写 breaking change) + AC-8 (7 天内不 rename) + AC-10 (CHANGELOG 1 条 user freeze)
**Estimated effort:** 0.25 working days, single dev, full-auto
**Job mode:** NO

---

## Hard Constraints (inherited from spec §0)

- **HC-1 一次到位:** S2 lands in 4.0.0-beta.5 with S0 + S1 + S3.
- **HC-2 不计成本:** Do NOT skip the CHANGELOG entry; do NOT make peaks-code's README description longer than 1 sentence.
- **HC-4 禁止假绿:** Sub-agent reports MUST include raw `peaks skill list` output + `peaks code --help` output + `peaks skill search --query dispatcher` output, showing peaks-solo present + peaks-code unchanged.
- **HC-6 全量回归:** S2 sign-off MUST run `pnpm vitest run` + verify peaks-code 4.0.0-beta.4 functionality intact.
- **HC-7 7 天 rename 红线:** S2 does NOT rename peaks-solo. After S2 lands, the peaks-solo name is locked for 7 days.
- **HC-8 peaks-code 0 改动 (with 1 optional sentence):** S2 MAY add ≤ 20 字 to peaks-code's SKILL.md description. Do NOT modify peaks-code's behavior, runbook, step 0, or any other file.
- **HC-9 Human-NL-Choice-Only / Two-Forms-Only 兼容:** S2's CHANGELOG wording MUST NOT require user to type CLI verbs. README MUST say "自然语言描述" or "用 /peaks-solo" (slash command is OK; raw CLI is not).
- **HC-10 老入口保留:** S2 MUST NOT touch `peaks-code`, `peaks-content`, `peaks-doctor`, `peaks-issue-fix-orchestrator` skill behaviors. Verify via `peaks code --help` and `peaks content --help` exit 0.

---

## Goal

Land the 4.0.0-beta.5 release's user-facing surface: marketplace.json registers `peaks-solo`, CHANGELOG records the addition, README points users to the new dispatcher, and (optionally) peaks-code's description gets a 1-sentence pointer to peaks-solo. After S2, `peaks skill list` shows peaks-solo, the 4.0.0-beta.5 release note exists, and the README correctly explains the dispatcher role.

**v1 scope:** 1 marketplace.json entry + 1 CHANGELOG block (1 release) + 1 paragraph in README-zh + 1 paragraph in README-en + (optional) 1 sentence in peaks-code SKILL.md.

**Out of v1 scope:** A new README section "ecosystem of peaks-* skills" (could be S2.5 / later); reorganizing existing README sections; changing the project description.

---

## Deliverables

| # | File | Action | Description |
|---|---|---|---|
| 1 | `.claude-plugin/marketplace.json` | modify (1 entry added) | Add `peaks-solo` entry to the `plugins[0].skills[]` array |
| 2 | `CHANGELOG.md` | modify (1 release block added) | Add `## 4.0.0-beta.5 — 2026-07-08` block under `## [Unreleased]`, with `### Added` section + verification line |
| 3 | `README.md` (zh) | modify (1 paragraph added) | Add a short "peaks-solo" paragraph after the existing "peaks-code 是 code-domain 唯一的入口" section |
| 4 | `README-en.md` (en) | modify (1 paragraph added, mirrors zh) | Add an English version of the same paragraph |
| 5 | `skills/peaks-code/SKILL.md` | modify (optional, 1 sentence only) | Add ≤ 20 字 to description: "如不想自己选 / 用 /peaks-solo" (Chinese) or equivalent en. **Skip this if user is uncertain about wording.** |
| 6 | `package.json` | **NOT modified** (no new deps; version stays `4.0.0-beta.4` until user freezes in commit) | — |
| 7 | `src/**` | **NOT modified** (no code changes) | — |

---

## API Contract (locked)

### marketplace.json entry (locked structure)

```json
{
  "name": "peaks-solo",
  "path": "./skills/peaks-solo",
  "description": "Dispatcher (分诊员) — natural-language front door for the Peaks-Loop skill family. Use when the user describes a task in NL and does not know which peaks-* skill fits. NOT for code/content/doctor/issue-fix-orchestrator/SOP work (use the specific skill)."
}
```

**Position:** Insert in `plugins[0].skills[]` array **before** `peaks-code` entry (peaks-solo is the new front door; peaks-code is the code-domain leaf). Verify by `peaks skill list` showing peaks-solo before peaks-code.

### CHANGELOG block (locked structure, user freeze 措辞)

```markdown
## 4.0.0-beta.5 — 2026-07-08

### Added — peaks-solo dispatcher (分诊员)

- **`peaks-solo` skill** — `skills/peaks-solo/SKILL.md` + 3 references (triage / fallback / sediment). Natural-language front door for the Peaks-Loop skill family. Use when the user describes a task in NL and does not know which peaks-* skill fits. 0 breaking change: 3.x / 4.x `/peaks-code` / `/peaks-content` / `/peaks-doctor` etc. continue to work.
- **`peaks skill search` CLI** — `src/services/skill/skill-search-service.ts` + `src/cli/commands/skill-search-commands.ts`. Query / tag / domain filters; substring match; structured JSON output. Used by `peaks-solo` to find the right leaf skill. Available as a top-level primitive (not dispatcher-specific).
- **Sub-skills unchanged** — `peaks-code / peaks-content / peaks-doctor / peaks-issue-fix-orchestrator / peaks-sop / etc.` are NOT modified. peaks-solo sits alongside, not on top.

### Verification (4.0.0-beta.5)

- `peaks skill list` shows `peaks-solo` first
- `peaks skill search --query "code"` returns `peaks-code` with matchScore > 0
- `peaks skill search --query "xxxxxxxxxxxxx"` returns `[]` (no error)
- `pnpm vitest run` — full regression green; `peaks-code / peaks-content / peaks-doctor` tests unchanged
- `peaks code --help` / `peaks content --help` / `peaks doctor --help` — exit 0, behavior unchanged
```

**Position:** Insert **after** `## [Unreleased]` (which stays empty for now), **before** `## 4.0.0-beta.4 — 2026-07-08`.

**Note:** Date `2026-07-08` is locked (today's date). The `[Unreleased]` section stays empty — it's reserved for the next minor that has UNRELEASED changes.

### README-zh paragraph (locked wording, ≤ 150 字)

Insert **after** the existing `### peaks-code 是 code-domain 唯一的入口` section:

```markdown
### peaks-solo 是分诊员(新增,4.0.0-beta.5)

如果**你不知道该用哪个 peaks-* 技能**,直接用 `/peaks-solo` 描述你的诉求就行。它会替你分诊:有合适的 leaf 就透明转交,没合适的就自己规划 + 跑(deep-search / WebSearch / Bash / Edit markdown),跑完回头问你要不要沉淀。`/peaks-code` / `/peaks-content` / `/peaks-doctor` 等老入口照常可用,**0 breaking**。
```

### README-en paragraph (locked wording, ≤ 200 words)

Insert **after** the existing `### peaks-code is the code-domain entry — and only the code-domain entry` section:

```markdown
### peaks-solo is the dispatcher (new in 4.0.0-beta.5)

If you **don't know which peaks-* skill to use**, just type `/peaks-solo` and describe your task in natural language. It triages for you: dispatches to a matching leaf, or self-plans with deep-search / WebSearch / Bash / Edit markdown if no leaf fits, then asks whether to sediment the result. `/peaks-code` / `/peaks-content` / `/peaks-doctor` etc. continue to work — **zero breaking changes**.
```

### peaks-code SKILL.md description (OPTIONAL addendum, ≤ 20 字)

If user opts in:

```yaml
description: |
  Code-domain loop engineering orchestrator for the Peaks-Loop skill family. ...
  [EXISTING CONTENT, KEEP]
  ... 如不知道选哪个,用 /peaks-solo。
```

**Skip this modification if user prefers 0-touch on peaks-code.** Both options are valid per HC-8.

---

## Sub-agent fan-out

Per HC-3, S2 fans out into 4 parallel sub-agents:

| Sub-agent | DAG node | Output | Dependency | Karpathy required |
|---|---|---|---|---|
| **S2-A** | `marketplace-entry` | `.claude-plugin/marketplace.json` modified | depends on S1 (peaks-solo/SKILL.md exists) | ✓ |
| **S2-B** | `changelog-block` | `CHANGELOG.md` modified | depends on S0 (CLI exists) + S1 (skill exists) | ✓ |
| **S2-C** | `readme-zh` | `README.md` modified | depends on S1 | ✓ |
| **S2-D** | `readme-en` | `README-en.md` modified | depends on S1 (mirrors zh) | ✓ |
| **S2-E** | `peaks-code-pointer` (optional) | `skills/peaks-code/SKILL.md` description append | depends on S1 + user opt-in | ✓ |
| **S2-Verify** | `regression-check` | vitest + `peaks skill list` + `peaks code --help` + `peaks content --help` + `peaks doctor --help` | depends on S2-A..E | N/A (verifier) |

**DAG file (write to `.peaks/_runtime/<sessionId>/sc/slice-dag-s2.json`):**
```json
{
  "nodes": [
    { "id": "marketplace-entry", "deps": [] },
    { "id": "changelog-block", "deps": [] },
    { "id": "readme-zh", "deps": [] },
    { "id": "readme-en", "deps": [] },
    { "id": "peaks-code-pointer", "deps": [] },
    { "id": "regression-check", "deps": ["marketplace-entry", "changelog-block", "readme-zh", "readme-en", "peaks-code-pointer"] }
  ]
}
```

All 4 main nodes can run in parallel; they touch different files.

---

## Test cases

S2 has no new test files (it's a release surface slice). Verification is via regression + smoke:

| # | Test | Command | Expected |
|---|---|---|---|
| V-1 | peaks-solo registered | `peaks skill list \| head -3` | first line is peaks-solo |
| V-2 | peaks-solo description contains "Dispatcher" | `peaks skill list \| grep -A 1 peaks-solo \| head -2` | description contains "Dispatcher" |
| V-3 | peaks skill search works | `peaks skill search --query "code" \| jq '.[0].name'` | "peaks-code" |
| V-4 | peaks skill search no-match | `peaks skill search --query "xxxxxxxxxxxxx" \| jq 'length'` | 0 |
| V-5 | peaks-code unchanged behavior | `peaks code --help \| head -5` | exit 0; first 5 lines identical to pre-S0 baseline |
| V-6 | peaks-content unchanged | `peaks content --help \| head -5` | exit 0; identical to baseline |
| V-7 | peaks-doctor unchanged | `peaks doctor --help \| head -5` | exit 0; identical to baseline |
| V-8 | Full vitest regression | `pnpm vitest run` | N/N passed (N includes S0 + S1 + pre-existing) |
| V-9 | CHANGELOG has 4.0.0-beta.5 block | `grep "4.0.0-beta.5" CHANGELOG.md` | at least 1 line |
| V-10 | README-zh has peaks-solo paragraph | `grep "peaks-solo" README.md` | at least 1 line |
| V-11 | README-en has peaks-solo paragraph | `grep "peaks-solo" README-en.md` | at least 1 line |

**Total: 11 verification cases.**

---

## Evidence required for S2 sign-off (HC-4)

```bash
# 1. marketplace.json validates (JSON parse + peaks-solo entry present)
node -e "console.log(JSON.parse(require('fs').readFileSync('.claude-plugin/marketplace.json','utf-8')).plugins[0].skills.find(s => s.name === 'peaks-solo'))"
# Expected: object with name, path, description (non-empty)

# 2. peaks skill list output (first 5 lines)
peaks skill list | head -5
# Expected: peaks-solo first; peaks-code second; etc.

# 3. peaks skill search smoke
peaks skill search --query "code" | head -20
# Expected: JSON array with peaks-code entry

# 4. CHANGELOG section count
rg "## 4\.0\.0-beta\.5" CHANGELOG.md
# Expected: 1 line (the section header)

# 5. README-zh / README-en paragraph presence
rg "peaks-solo" README.md
rg "peaks-solo" README-en.md
# Expected: ≥ 1 line each

# 6. Full vitest regression
pnpm vitest run
# Expected: N/N passed

# 7. HC-8 verify (peaks-code 0 lines changed in this slice, optional sentence)
git diff --stat main...HEAD -- skills/peaks-code/SKILL.md
# Expected: ≤ 1 line changed (if optional sentence added); 0 lines if skipped

# 8. peaks-code/content/doctor help smoke
peaks code --help | head -3
peaks content --help | head -3
peaks doctor --help | head -3
# Expected: all 3 exit 0; first 3 lines identical to pre-S0 baseline
```

---

## Exit conditions

- [ ] `.claude-plugin/marketplace.json` has `peaks-solo` entry inserted before `peaks-code`
- [ ] `CHANGELOG.md` has `## 4.0.0-beta.5 — 2026-07-08` block with `### Added — peaks-solo dispatcher` subsection
- [ ] `CHANGELOG.md` is valid markdown (no broken formatting; existing 4.0.0-beta.4 section intact)
- [ ] `README.md` (zh) has the peaks-solo paragraph after the peaks-code section
- [ ] `README-en.md` (en) has the English peaks-solo paragraph
- [ ] (Optional) `skills/peaks-code/SKILL.md` description has ≤ 20 字 pointer to peaks-solo
- [ ] `peaks skill list` shows peaks-solo first
- [ ] `peaks skill search --query "code"` returns peaks-code
- [ ] Full `pnpm vitest run` green
- [ ] `peaks code --help` / `peaks content --help` / `peaks doctor --help` exit 0 with identical pre-S0 output
- [ ] HC-8 verified: peaks-code 0 lines (or ≤ 1 line if optional)
- [ ] All 8 evidence items present

**If any box unchecked, S2 BLOCKED. Do NOT proceed to S3.**

---

## Risks (S2-specific annotations)

| # | Risk | Severity | S2-specific mitigation |
|---|---|---|---|
| R6 | CHANGELOG 措辞 user freeze 卡住 S2 | Low | S2-B MUST use the locked wording from §"API Contract" verbatim. Sub-agent must NOT paraphrase or "improve" the wording. If the user wants different wording, fail S2 with reason "user override needed" and ask user to provide the new wording verbatim. |
| **R11** (new) | marketplace.json syntax error breaks `peaks skill list` | High | S2-A MUST validate JSON syntax after edit: `node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/marketplace.json','utf-8'))"` MUST exit 0. If JSON parse fails, S2 BLOCKED. |
| **R12** (new) | peaks-code description append breaks lint / format | Medium | S2-E (optional) MUST add the ≤ 20 字 sentence AT THE END of the existing description, in the same paragraph. Do NOT insert a new line. Do NOT modify the existing text. If peaks-code's SKILL.md is reformatted by accident, revert the change. |

---

## Self-check (Karpathy #4 Goal-Driven Execution)

- **Goal:** S2 = release surface for 4.0.0-beta.5. Without S2, the dispatcher + CLI from S0 + S1 are "internal" only — `peaks skill list` won't show peaks-solo, CHANGELOG has no entry, README has no pointer, downstream users can't find it.
- **Simplicity:** 4-5 file edits, all template-following. No src/** code. No new dependencies.
- **Surgical:** Does NOT modify peaks-code behavior. Does NOT touch existing CHANGELOG sections. Does NOT restructure README.
- **Goal-driven:** V-1, V-2, V-5, V-6, V-7, V-9, V-10, V-11 → AC-7 (老入口保留), AC-8 (7 天 no rename), AC-10 (CHANGELOG 1 条). V-3, V-4 → cross-validate S0 + S1 functionality.

---

## Related

- `docs/superpowers/specs/2026-07-08-peaks-solo-dispatcher-design.md` §2.1, §1.1
- `docs/superpowers/plans/2026-07-08-peaks-solo-dispatcher/index.md` §Hard Constraints + §Slice Map
- `docs/superpowers/plans/2026-07-08-peaks-solo-dispatcher/s0-skill-search-cli.md` (S2 depends on S0)
- `docs/superpowers/plans/2026-07-08-peaks-solo-dispatcher/s1-peaks-solo-skill.md` (S2 depends on S1)
- `CHANGELOG.md` (existing 4.0.0-beta.4 section is the format template)
- `README.md` + `README-en.md` (existing peaks-code section is the insertion point)
- `.claude-plugin/marketplace.json` (existing peaks-code entry is the format template)
- `.peaks/memory/user-decision-2026-07-08-revive-peaks-solo-as-dispatcher.md` (HC-1..HC-11 source)
