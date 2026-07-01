<!--
Extracted from: 2026-06-25-slice-topology-multipass.md (1626-line original, split on 2026-06-25 post Wave 1)
Section: Title + Intro + Global Constraints + File Structure
Original lines: 1-108
This file is part of the slice-topology-multipass plan split.
See the index at ./2026-06-25-slice-topology-multipass.md for navigation.
-->

# Slice Topology Multi-Pass + 10/90 Paradigm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build peaks-loop's 10% human / 90% LLM autonomous workflow foundation: multi-pass slice decomposition, audit+goal gate, final review gate, structured handoff frontmatter, and LLM-facing skill layer.

**Architecture:** Existing 6-stage slice decomposition algorithm (`src/services/slice/slice-decompose-service.ts`) stays UNCHANGED as the inner loop. A new `MultiPassOrchestrator` invokes it multiple times at different granularities (service → file), joined by a `CrossPassEdgeMerger`. New primitives `auditGoal()` and `prepareFinalReview()` gate autonomous LLM execution between human touchpoints. A new `peaks-slice-decompose`, `peaks-audit`, and `peaks-final-review` skill tells the LLM when/how to invoke these. Handoff artifacts gain a YAML frontmatter schema for structured fields.

**Tech Stack:** TypeScript 5.x, Node.js, vitest (TDD), `peaks codegraph` CLI (optional), YAML parser (already a dep for `.peaks/standards/`).

## Global Constraints

- **Author**: Every git commit must use `SquabbyZ <601709253@qq.com>`. Use `git commit --author="SquabbyZ <601709253@qq.com>"` for every commit.
- **Branch**: All work happens on `feature/slice-topology-multipass` (off `develop`). Never commit to `main` directly.
- **File size cap**: Every file ≤ 800 lines (enforced by `peaks scan file-size` gate). Split when approaching.
- **No console.log in production code** (enforced by lint).
- **Test coverage**: ≥ 80% per new file (statements, branches, functions, lines).
- **Mutation probes**: 3 probes must survive their targeted mutations (per peaks-loop Plan 4 convention).
- **Backward compat**: v1 schema (`DecompositionResult`) and legacy handoffs (no frontmatter) must remain readable via `SchemaRouter` / `parseHandoff` respectively.
- **LLM 兜底 budget**: Max 2 LLM calls per `peaks slice decompose` and per `peaks audit-goal` and per `peaks prepare-final-review` invocation. Never throws on budget exhaustion.
- **JSON for structured data** (types, schemas), **markdown for prose** (skills, handoff body, references). YAML frontmatter bridges both.
- **No new mode** in `peaks-loop` CLI: everything folds into existing modes via shape-selector logic.

## File Structure

### New files (production)

```
src/services/slice/
├── slice-topology-types.ts            (Phase 1: types for v2 schema)
├── schema-router.ts                   (Phase 2: read/write v1+v2 by schemaVersion)
├── llm-arbitrator.ts                  (Phase 2: budget-capped LLM with content-hash cache)
├── granularity-decider.ts             (Phase 2: stop condition + LLM tie-break)
├── cross-pass-edge-merger.ts          (Phase 2: type/fixture/import-re-export edges)
├── multi-pass-orchestrator.ts         (Phase 2: invokes 6-stage N times)

src/services/audit/
├── audit-goal-types.ts                (Phase 1: AuditGoalInput/Output/AuditDimension)
└── audit-goal-service.ts              (Phase 1: auditGoal() function)

src/services/final-review/
├── final-review-types.ts              (Phase 1: DimensionEvidence/EvidenceItem/FinalReviewOutput)
└── final-review-service.ts            (Phase 1: prepareFinalReview() function)

src/services/handoff/
├── handoff-types.ts                   (Phase 1: HandoffFrontmatter + status enums)
├── handoff-parser.ts                  (Phase 1: parse YAML frontmatter + body)
└── handoff-writer.ts                  (Phase 1: write YAML frontmatter + body)

schemas/
├── decomposition-v1.json              (Phase 1: extracted from current types)
└── decomposition-v2.json              (Phase 1: new schema with passes[] + crossPassEdges)
```

### New files (skills)

```
skills/peaks-slice-decompose/
├── SKILL.md                           (Phase 4: 50-80 lines)
└── references/
    ├── v2-schema.md
    ├── granularity-decision.md
    └── cross-pass-edge-interpretation.md

skills/peaks-audit/
├── SKILL.md                           (Phase 4)
└── references/6-dimensions.md

skills/peaks-final-review/
├── SKILL.md                           (Phase 4)
└── references/4-dimensions.md
```

### New files (tests)

```
tests/unit/slice/
├── slice-topology-types.test.ts
├── schema-router.test.ts
├── llm-arbitrator.test.ts
├── granularity-decider.test.ts
├── cross-pass-edge-merger.test.ts
├── multi-pass-orchestrator.test.ts
└── integration/slice-decompose-e2e.test.ts

tests/unit/audit/audit-goal-service.test.ts
tests/unit/final-review/final-review-service.test.ts
tests/unit/handoff/
├── handoff-parser.test.ts
└── handoff-writer.test.ts
```

### Modified files

```
src/cli/commands/slice-decompose.ts       (Phase 3: add --granularity flag)
src/services/slice/slice-pick-service.ts  (Phase 3: use SchemaRouter.readResult)
src/services/slice/slice-plan-service.ts  (Phase 3: use SchemaRouter.readResult)
skills/peaks-solo/SKILL.md                (Phase 5: Step 0.6 audit + end-of-workflow final review)
skills/peaks-rd/SKILL.md                  (Phase 5: v2 slice reading + handoff frontmatter writing)
skills/peaks-qa/SKILL.md                  (Phase 5: handoff frontmatter reading)
skills/peaks-prd/SKILL.md                 (Phase 5: multi-pass AC reference)
skills/peaks-sc/SKILL.md                  (Phase 5: reference peaks-slice-decompose)
CHANGELOG.md                              (Phase 6: v2.10.0 entry)
```

---

