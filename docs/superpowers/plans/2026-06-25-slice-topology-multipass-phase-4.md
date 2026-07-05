<!--
Extracted from: 2026-06-25-slice-topology-multipass.md (1626-line original, split on 2026-06-25 post Wave 1)
Section: Phase 4: New Skills
Original lines: 1212-1381
This file is part of the slice-topology-multipass plan split.
See the index at ./2026-06-25-slice-topology-multipass.md for navigation.
-->

## Phase 4: New Skills

### Task 12: peaks-slice-decompose skill

**Files:**
- Create: `skills/peaks-slice-decompose/SKILL.md`
- Create: `skills/peaks-slice-decompose/references/v2-schema.md`
- Create: `skills/peaks-slice-decompose/references/granularity-decision.md`
- Create: `skills/peaks-slice-decompose/references/cross-pass-edge-interpretation.md`

- [ ] **Step 1: Write SKILL.md**

```markdown
# peaks-slice-decompose

Decompose a PRD into a hierarchical v2 slice topology.

## Trigger conditions

Invoke this skill when:
- A PRD (peaks-prd output) is ready and needs to be decomposed into slices.
- An approved goal exists at `.peaks/_runtime/<sid>/audit-goal/<rid>.json`.
- No existing v2 decomposition at `.peaks/sc/slice-decomposition/<rid>.json`.

## Precondition

An approved goal MUST exist. If not, return to peaks-code to invoke peaks-audit first.

## Invocation

```bash
peaks slice decompose --rid <rid> --granularity <service|file|both|auto>
```

Default granularity: `both`.

## Output

A v2 JSON file at `.peaks/sc/slice-decomposition/<rid>.json` with:
- `schemaVersion: "v2"`
- `passes[]` (Pass 1 = service, Pass 2 = file)
- `crossPassEdges[]` (type-shares / fixture-shares / import-re-export / llm-arbitrated)
- `llmArbitrations[]` (≤ 2 calls per invocation)

Read via `SchemaRouter.readResult(<path>)` — never parse the file directly.

## Cross-references

- peaks-rd: consumes `passes[].slices` for sub-agent dispatch.
- peaks-qa: reads `passes[].slices[].parentSliceId` for verification.
- peaks-final-review: reads `crossPassEdges` to determine ordering for evidence collection.
```

- [ ] **Step 2: Write references/v2-schema.md** (field-by-field table for DecompositionResultV2)

- [ ] **Step 3: Write references/granularity-decision.md** (decision tree)

- [ ] **Step 4: Write references/cross-pass-edge-interpretation.md** (how to read edges for dispatch ordering)

- [ ] **Step 5: Test SKILL.md loads** (no markdown parse errors, all references reachable)

- [ ] **Step 6: Commit**

```bash
git add skills/peaks-slice-decompose/
git commit --author="SquabbyZ <601709253@qq.com>" -m "feat(skill): add peaks-slice-decompose with v2 schema references"
```

### Task 13: peaks-audit skill

**Files:**
- Create: `skills/peaks-audit/SKILL.md`
- Create: `skills/peaks-audit/references/6-dimensions.md`

- [ ] **Step 1: Write SKILL.md**

```markdown
# peaks-audit

Audit a need across 6 dimensions and propose a goal for human approval.

## Trigger conditions

Invoke immediately after human need expression, BEFORE any PRD/RD/QA work.

## Invocation

Via peaks-code Step 0.6: `peaks audit-goal --need "<natural language need>" --json`

## Output

An `AuditGoalOutput` with:
- `summary` (1-2 sentences)
- `audit[]` (EXACTLY 6 dimensions, each with severity)
- `proposedGoal` (what success looks like)
- `successCriteria[]` (acceptance criteria)
- `roughEffort` (small | medium | large | epic)
- `confidence` (high | medium | low)
- `rationale` (one paragraph tying audit → goal)

## 6 dimensions

See references/6-dimensions.md for detailed definitions and examples.

## One-shot accuracy

The audit must be good enough that the human accepts the goal on first review.
```

- [ ] **Step 2: Write references/6-dimensions.md**

- [ ] **Step 3: Test and commit**

```bash
git add skills/peaks-audit/
git commit --author="SquabbyZ <601709253@qq.com>" -m "feat(skill): add peaks-audit with 6-dim reference"
```

### Task 14: peaks-final-review skill

**Files:**
- Create: `skills/peaks-final-review/SKILL.md`
- Create: `skills/peaks-final-review/references/4-dimensions.md`

- [ ] **Step 1: Write SKILL.md**

```markdown
# peaks-final-review

Prepare 4-dim business review evidence for human acceptance.

## Trigger conditions

Invoke after all autonomous LLM work (RD, QA, security, perf) is complete, BEFORE final delivery.

## Invocation

Via peaks-code end-of-workflow: `peaks prepare-final-review --rid <rid> --json`

## Output

A `FinalReviewOutput` with:
- `dimensions[]` (EXACTLY 4 dimensions, each with verdict + evidence)
- `overallSummary`
- `allPass` (boolean)
- `needsAttention[]` (list of dimensions needing human judgment)

## 4 dimensions

1. **functional-completeness** — AC → passing test mapping
2. **problem-resolution** — targeted test for original problem case
3. **no-new-bugs** — regression suite + spot-checks
4. **existing-functionality-intact** — pre/post baseline diff

## Human's role

The human reviews evidence and judges business outcomes (NOT code).
```

- [ ] **Step 2: Write references/4-dimensions.md**

- [ ] **Step 3: Test and commit**

```bash
git add skills/peaks-final-review/
git commit --author="SquabbyZ <601709253@qq.com>" -m "feat(skill): add peaks-final-review with 4-dim reference"
```

---

