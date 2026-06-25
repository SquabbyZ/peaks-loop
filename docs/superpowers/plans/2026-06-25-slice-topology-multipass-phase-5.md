<!--
Extracted from: 2026-06-25-slice-topology-multipass.md (1626-line original, split on 2026-06-25 post Wave 1)
Section: Phase 5: Existing Skill Updates
Original lines: 1382-1489
This file is part of the slice-topology-multipass plan split.
See the index at ./2026-06-25-slice-topology-multipass.md for navigation.
-->

## Phase 5: Existing Skill Updates

### Task 15: peaks-solo update (Step 0.6 audit + end-of-workflow final review)

**Files:**
- Modify: `skills/peaks-solo/SKILL.md`

- [ ] **Step 1: Locate existing Step 0.5 / Step 0.7 in peaks-solo SKILL.md**

- [ ] **Step 2: Add new Step 0.6 (audit) between Step 0.5 and Step 0.7**

```markdown
### Step 0.6: Audit + Goal (NEW)

After human expresses need, invoke peaks-audit to summarize + multi-dim audit + propose goal. Display audit + goal to human for one-shot approval. Store approved goal at `.peaks/_runtime/<sid>/audit-goal/<rid>.json`. **All subsequent autonomous work requires an approved goal.**

### Step N+1: Final Review (NEW)

After all autonomous LLM work (RD, QA, security, perf) completes, invoke peaks-final-review to prepare 4-dim evidence. Display evidence to human for judgment. If all 4 dims pass → final delivery. If any fail → loop back with feedback.
```

- [ ] **Step 3: Update Step references** (any "after Step 0.5" → "after Step 0.6")

- [ ] **Step 4: Verify SKILL.md loads**

- [ ] **Step 5: Commit**

```bash
git add skills/peaks-solo/SKILL.md
git commit --author="SquabbyZ <601709253@qq.com>" -m "feat(skill): peaks-solo adds audit gate + final review gate"
```

### Task 16: peaks-rd update (v2 slice reading + handoff frontmatter writing)

**Files:**
- Modify: `skills/peaks-rd/SKILL.md`
- Create: `skills/peaks-rd/references/reading-v2-slice-results.md`
- Create: `skills/peaks-rd/references/writing-handoff-frontmatter.md`

- [ ] **Step 1: Write `references/reading-v2-slice-results.md`** (how to read v2 via SchemaRouter, dispatch per pass)

- [ ] **Step 2: Write `references/writing-handoff-frontmatter.md`** (mandatory frontmatter fields)

- [ ] **Step 3: Update peaks-rd/SKILL.md to reference both**

- [ ] **Step 4: Commit**

```bash
git add skills/peaks-rd/
git commit --author="SquabbyZ <601709253@qq.com>" -m "feat(skill): peaks-rd adds v2 reading + frontmatter writing"
```

### Task 17: peaks-qa update (handoff frontmatter reading)

**Files:**
- Modify: `skills/peaks-qa/SKILL.md`
- Create: `skills/peaks-qa/references/reading-handoff-frontmatter.md`

- [ ] **Step 1: Write reference**

- [ ] **Step 2: Update SKILL.md**

- [ ] **Step 3: Commit**

```bash
git add skills/peaks-qa/
git commit --author="SquabbyZ <601709253@qq.com>" -m "feat(skill): peaks-qa reads handoff frontmatter"
```

### Task 18: peaks-prd update (multi-pass AC reference)

**Files:**
- Modify: `skills/peaks-prd/SKILL.md`
- Create: `skills/peaks-prd/references/prd-for-multi-pass.md`

- [ ] **Step 1: Write reference** (how to write ACs that yield clean slice boundaries)

- [ ] **Step 2: Update SKILL.md**

- [ ] **Step 3: Commit**

```bash
git add skills/peaks-prd/
git commit --author="SquabbyZ <601709253@qq.com>" -m "feat(skill): peaks-prd adds multi-pass AC reference"
```

### Task 19: peaks-sc update (reference peaks-slice-decompose)

**Files:**
- Modify: `skills/peaks-sc/SKILL.md`

- [ ] **Step 1: Add reference link to peaks-slice-decompose in peaks-sc/SKILL.md**

```markdown
### Slice planning first step

The first step in slice planning is to invoke `peaks-slice-decompose` to produce a v2 topology. See [peaks-slice-decompose/SKILL.md](../peaks-slice-decompose/SKILL.md).
```

- [ ] **Step 2: Commit**

```bash
git add skills/peaks-sc/SKILL.md
git commit --author="SquabbyZ <601709253@qq.com>" -m "feat(skill): peaks-sc references peaks-slice-decompose"
```

---

