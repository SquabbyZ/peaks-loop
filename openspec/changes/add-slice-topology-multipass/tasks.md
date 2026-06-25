# Tasks: add-slice-topology-multipass

> Execute in order. Each task is a TDD cycle (RED → GREEN → IMPROVE). Do not start a new task until the prior task's quality gates pass.

## 1. Slice topology types + v2 schema

- [ ] Write `src/services/slice/slice-topology-types.ts` with `SchemaVersion`, `PassConfig`, `SliceV2`, `InternalEdge`, `CrossPassEdge`, `LlmArbitration`, `PassResult`, `DecompositionResultV2`.
- [ ] Write `schemas/decomposition-v2.json` matching `DecompositionResultV2`.
- [ ] Write `schemas/decomposition-v1.json` extracted from existing v1 type contract (so v1 has an explicit schema).
- [ ] Unit tests: schema roundtrip (parse → serialize → parse-equal) for both versions.

## 2. SchemaRouter

- [ ] Write `src/services/slice/schema-router.ts` with `readResult(filePath)` and `writeResult(filePath, result)`.
- [ ] Routes by `schemaVersion` field; throws `UnknownSchemaVersionError` for unrecognised values.
- [ ] Unit tests: read v1 file, read v2 file, write v1 file, write v2 file, unknown version.

## 3. LLMArbitrator

- [ ] Write `src/services/slice/llm-arbitrator.ts` with `arbitrate(prompt, opts)` and content-hash keyed disk cache.
- [ ] Budget cap: ≤ 2 calls per invocation; never throws on budget exhaustion.
- [ ] Unit tests: cache hit, cache miss + success, timeout, budget exhausted, runner error.
- [ ] Mutation probe C: removing cache lookup must break the cache-hit latency test.

## 4. GranularityDecider

- [ ] Write `src/services/slice/granularity-decider.ts` with `shouldSubdivide(wu, thresholds)`.
- [ ] Default thresholds: `maxFiles: 3`, `maxLoc: 400`.
- [ ] Returns `'tie-break'` signal when WU is within 20% of either threshold.
- [ ] Unit tests: small WU, large WU, borderline, multi-file, edge-of-threshold.
- [ ] Mutation probe B: flipping `>` to `>=` must break the edge-of-threshold fixture.

## 5. CrossPassEdgeMerger

- [ ] Write `src/services/slice/cross-pass-edge-merger.ts` with `merge(passes, llmRunner)`.
- [ ] Static detection: type shares, fixture shares, import re-export.
- [ ] LLM 兜底: ≤ 2 calls per invocation; falls back to conservative topo on ambiguity.
- [ ] Unit tests: type-shares detected, fixture-shares detected, import-re-export detected, LLM-arbitrated, all-ambiguous.
- [ ] Mutation probe A: commenting out type-sharing detection must break the type-share integration test.

## 6. MultiPassOrchestrator

- [ ] Write `src/services/slice/multi-pass-orchestrator.ts` with `decompose(rid, prdMarkdown, projectRoot, opts)`.
- [ ] Dispatches to 1 or 2 passes based on `granularity` option (Pass 3 deferred to v2 of this change).
- [ ] Pass 2 internal calls run in parallel (`Promise.all` over the parent's slices).
- [ ] Reuses `decomposeSlices` from `slice-decompose-service.ts` UNCHANGED.
- [ ] Unit tests: single-Pass, 2-Pass, ambiguous, mocked `decomposeSlices` and `LLMArbitrator`.
- [ ] Integration tests against `src/services/config/` and `src/services/memory/` (peaks-cli real codebase).

## 7. CLI integration

- [ ] Add `--granularity=service|file|both|auto` flag to `peaks slice decompose` (default `both`).
- [ ] Update `peaks slice pick` and `peaks slice plan` to use `SchemaRouter.readResult()` (additive change).
- [ ] CLI tests: each granularity option produces expected pass count.

## 8. Skill layer (LLM-facing operation manuals)

The CLI exposes atomic primitives; skills are how the LLM knows when to invoke which primitive and how to interpret output. Both ship together.

### 8.1 New skill: `peaks-slice-decompose`

- [ ] Create `skills/peaks-slice-decompose/SKILL.md` (50-80 lines, the entry point).
- [ ] Create `skills/peaks-slice-decompose/references/v2-schema.md` (DecompositionResultV2 field-by-field reference).
- [ ] Create `skills/peaks-slice-decompose/references/granularity-decision.md` (decision tree for `--granularity`).
- [ ] Create `skills/peaks-slice-decompose/references/cross-pass-edge-interpretation.md` (downstream agent dispatch rules).
- [ ] Skill tests: SKILL.md loads without markdown parse errors; all referenced files exist; no broken cross-references.

### 8.2 Updated skills (additive references only — no breaking changes to existing content)

- [ ] Update `peaks-solo/SKILL.md`: add reference link to `peaks-slice-decompose/SKILL.md` in the slice planning section.
- [ ] Update `peaks-rd/SKILL.md`: add `references/reading-v2-slice-results.md` (~80 LoC) explaining how to consume the v2 JSON via SchemaRouter.
- [ ] Update `peaks-qa/SKILL.md`: add `references/cross-pass-edge-verification.md` (~80 LoC) explaining cross-pass edge verification.
- [ ] Update `peaks-prd/SKILL.md`: add `references/prd-for-multi-pass.md` (~80 LoC) explaining how to write ACs that yield clean slice boundaries.
- [ ] Update `peaks-sc/SKILL.md`: add reference link to `peaks-slice-decompose/SKILL.md` as the first step in slice planning.

## 9. Audit + Goal primitive (10% human / 90% LLM paradigm gate)

The audit + goal step is the bridge between human need expression and autonomous LLM execution. It MUST produce a goal that the human accepts on first review (one-shot accuracy).

### 9.1 Audit types + service

- [ ] Add `src/services/audit/audit-goal-types.ts` with `AuditGoalInput`, `AuditGoalOutput`, `AuditDimension` types.
- [ ] Add `src/services/audit/audit-goal-service.ts` with `auditGoal(input, llmRunner)` function.
- [ ] Validation: throw `IncompleteAuditError` if any of the 6 audit dimensions is missing in the LLM output.
- [ ] Unit tests: all 6 dimensions present, missing-dimension failure, malformed JSON output handling.

### 9.2 New skill: peaks-audit

- [ ] Create `skills/peaks-audit/SKILL.md` (50-80 lines, the entry point).
- [ ] Document the 3 human touchpoints (need expression, goal approval, final acceptance).
- [ ] Document the 6 audit dimensions (correctness, completeness, scope, risks, alternatives, constraints) with examples.
- [ ] Document the one-shot accuracy target and tactics for achieving it.
- [ ] Skill tests: SKILL.md loads, all referenced files exist, no broken cross-references.

### 9.3 Integration with peaks-solo and peaks-slice-decompose

- [ ] Update `peaks-solo/SKILL.md` Step 0.6 (NEW — between Step 0.5 OpenSpec opt-in and Step 0.7 resume detection):
  - Invoke `peaks-audit` immediately after human need expression.
  - Display the audit + proposed goal to the human.
  - Gate the rest of the workflow on human's explicit goal approval.
  - Record the approved goal to `.peaks/_runtime/<sid>/audit-goal/<rid>.json` for downstream skills to read.
- [ ] Update `peaks-slice-decompose/SKILL.md` (in the v1 Skill layer work) to include an explicit precondition note: "This skill is invoked AFTER audit + goal approval. If you have not received an approved goal, do NOT invoke this skill — return to peaks-solo."
- [ ] Integration test: end-to-end peaks-solo flow with audit + goal approval gates slice-decompose invocation correctly.

## 10. Final Review primitive (4-dim business review)

Touchpoint #3 is NOT approve/reject — it is a structured 4-dim business review. LLM prepares evidence, human judges.

### 10.1 Final Review types + service

- [ ] Add `src/services/final-review/final-review-types.ts` with `DimensionEvidence`, `EvidenceItem`, `FinalReviewOutput` types.
- [ ] Add `src/services/final-review/final-review-service.ts` with `prepareFinalReview(rid, llmRunner)` function.
- [ ] Validation: throw `IncompleteFinalReviewError` if any of the 4 dimensions is missing.
- [ ] Read approved goal from `.peaks/_runtime/<sid>/audit-goal/<rid>.json` to map successCriteria → functional completeness.
- [ ] Write `FinalReviewOutput` to `.peaks/_runtime/<sid>/final-review/<rid>.json`.
- [ ] Unit tests: all 4 dimensions present, missing-dimension failure, all-pass verdict, mixed-pass verdict.

### 10.2 New skill: peaks-final-review

- [ ] Create `skills/peaks-final-review/SKILL.md` (50-80 lines, the entry point).
- [ ] Document the 4 dimensions with examples of pass/fail evidence per dimension.
- [ ] Document the human's role at touchpoint #3 (judgment on evidence, not on code).
- [ ] Document the distinction: code review = LLM; business review = human.
- [ ] Skill tests: SKILL.md loads, all referenced files exist, no broken cross-references.

### 10.3 Integration with peaks-solo

- [ ] Update `peaks-solo/SKILL.md` end-of-workflow Step (NEW):
  - After LLM signals all autonomous work complete (RD done, QA done, security done, perf done), invoke `peaks-final-review`.
  - Display the 4-dim evidence summary to the human.
  - Wait for human judgment (accept all / mark specific dims failed with feedback / add qualitative concern).
  - If accept all → final delivery.
  - If any dimension failed → loop back to LLM with feedback (stays within LLM's 90% authority).
- [ ] Integration test: peaks-solo flow with Final Review correctly accepts or loops back based on human input.

## 11. Handoff frontmatter schema (Option A — JSON for structure, markdown for prose)

The handoff artifact uses YAML frontmatter for structured fields + markdown body for prose context. This combines JSON's schema enforcement with markdown's prose flexibility.

### 11.1 Types + parser + writer

- [ ] Add `src/services/handoff/handoff-types.ts` with `HandoffFrontmatter`, `HandoffStatus`, `HandoffTestResult` types.
- [ ] Add `src/services/handoff/handoff-parser.ts` with `parseHandoff(filePath): { frontmatter, body }`.
- [ ] Add `src/services/handoff/handoff-writer.ts` with `writeHandoff(filePath, frontmatter, body)`.
- [ ] Use existing YAML parser (peaks-cli already depends on one for `.peaks/standards/`).
- [ ] Validation: throw `IncompleteHandoffError` if required fields missing (rid, slice_id, agent_id, schema_version, status, created_at).
- [ ] Backward compat: legacy handoffs without frontmatter parse with `schema_version: '0'`, `status: 'unknown'`. No automatic rewrite.
- [ ] Unit tests: parse valid handoff, parse invalid handoff (missing required fields), roundtrip (write → parse equal), legacy handoff backward compat.

### 11.2 Agent integration

- [ ] Update `peaks-rd/SKILL.md`: instruct RD agent to write frontmatter when producing handoff (status, files_changed, lines_added/removed, test_result, coverage).
- [ ] Update `peaks-qa/SKILL.md`: instruct QA agent to read frontmatter (status, test_result) and update if needed (e.g., override test_result after deeper testing).
- [ ] Update `peaks-final-review` skill (Task 10.2): read frontmatter for functional completeness (`files_changed`, `test_result`) and problem resolution evidence.

## 12. Documentation + standards

- [ ] Update `docs/superpowers/specs/` index (if any) to reference this change.
- [ ] Update `.peaks/standards/` slice-decompose reference (if any) to document v2 schema.
- [ ] Add a `CHANGELOG.md` entry under the next version.

## Quality Gates (after each task, before commit)

- [ ] `pnpm test --filter slice` passes (vitest unit + integration).
- [ ] `pnpm typecheck` passes (tsc --noEmit).
- [ ] `pnpm test:coverage` for new files: ≥ 80% statements, branches, functions, lines.
- [ ] Mutation probe for the just-completed task passes (probe survives its targeted mutation).
- [ ] No `console.log` in production code (lint check).
- [ ] No file > 800 lines (per peaks-cli standard; `peaks scan file-size` gate).

## Definition of Done

- All 8 tasks complete with quality gates green.
- All 3 mutation probes pass.
- A real run of `peaks slice decompose --granularity=both --rid <real-rid>` on a current peaks-cli task produces a v2 JSON file readable by `SchemaRouter`.
- CHANGELOG entry merged.
- PR opened from `feature/slice-topology-multipass` to `develop`.