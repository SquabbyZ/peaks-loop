# Change: add-slice-topology-multipass

## Why

peaks-solo's new fan-out RD architecture requires hierarchical slice decomposition (top-level sub-tasks that decompose into leaf files), but the current `peaks slice decompose` algorithm (`src/services/slice/slice-decompose-service.ts`) runs a single-pass single-level 6-stage pipeline that produces flat file-level WorkUnits only.

This flat output cannot model:
- **Hierarchical fan-out**: a task like "split `config-service` into 3 modules" needs one top-level slice that decomposes into 3 file-level sub-slices with topological order between them.
- **Cross-level dependencies**: when service A's type changes, file-level slices inside service B inherit a dependency. The flat algorithm cannot express this.
- **Multi-strategy granularity**: refactor tasks want file-level slices; cross-service feature additions want service-level slices. One fixed granularity wastes parallelism in either direction.

The recent 800-line cap refactors (config-service, doctor-service, project-memory-service — currently uncommitted on `main`) are exactly the kind of work this design would automate, and they ship as a manual decomposition pattern that we want to capture as a first-class algorithm shape.

User is the only consumer (`confirmed 2026-06-25`), so a breaking JSON schema change is acceptable as long as old files remain readable via a schema-version router.

## Product Philosophy (10% Human / 90% LLM)

This change is part of peaks-cli's broader shift to a **10% human / 90% LLM** model. The human's role is supervisor, not operator.

### 3 human touchpoints (the 10%)

1. **Need expression** — Human states the problem or need in natural language.
2. **Goal approval** — After LLM autonomously summarizes + audits + proposes a goal, human does a one-shot acceptance check.
3. **Final business review** — After LLM completes all work autonomously, human reviews **business outcomes** (not code) across 4 structured dimensions:
   - **Functional completeness** — Does the feature work as intended? All acceptance criteria met?
   - **Problem resolution** — Was the original problem actually fixed? (Specific to the need, not generic.)
   - **No new bugs introduced** — Did the work break anything that wasn't broken before? (Regression check.)
   - **Existing functionality intact** — Did the work preserve existing behavior? (Pre/post baseline comparison.)
   
   The LLM prepares structured evidence for each dimension; the human does the business judgment and either accepts or sends back with feedback.

**Critical**: touchpoint #3 is **business-outcome review**, NOT code review. Code review (CR / Security / Perf) is the LLM's responsibility (one of the 90%). The human reviews outcomes, not code.

### LLM's responsibility (the 90%)

- Multi-dimensional audit of the need (correctness, completeness, scope, risks, alternatives, constraints).
- Goal proposal synthesized from the audit.
- Slice decomposition (the algorithm in this change).
- Sub-agent dispatch per the decomposition.
- RD / QA / Security / Performance work.
- Verification of acceptance criteria.
- Iteration within its own authority.
- Final delivery preparation.

### One-shot accuracy target

When LLM presents the goal at touchpoint #2, the human should be able to accept on first review without iteration. **The audit is the critical gate for this** — a poor audit forces the human to iterate, which defeats the 10/90 model.

### Impact on this change

- The slice-decomposition algorithm is part of the LLM's autonomous execution chain (post goal approval).
- The `peaks-slice-decompose` skill is invoked by the LLM autonomously, not by the human via CLI.
- CLI primitives remain as LLM's internal tools; the skill layer is the LLM-facing surface.
- A new **Audit + Goal primitive** is introduced as the bridge between human need expression and autonomous execution. See design.md §"Audit + Goal primitive".

## What Changes

- Add `MultiPassOrchestrator` that runs the existing 6-stage algorithm multiple times at different granularities (service → file → optional sub-file), reusing `slice-decompose-service.ts` unmodified as each Pass's inner loop.
- Add `CrossPassEdgeMerger` that detects dependencies between adjacent passes (type sharing, test-fixture sharing, import re-export sharing) and falls back to an LLM 兜底 with a strict 2-call budget when the static signal is ambiguous.
- Add `GranularityDecider` that decides whether a given WorkUnit should be subdivided further, using a stop condition (file count ≤ 1 AND LoC < 400) and one LLM tie-breaker call when the heuristic is inconclusive.
- Add `LLMArbitrator` that wraps the LLM call with caching (content-hash keyed) and a per-invocation token budget (4000 input + 1000 output).
- **Reserve Pass 3 (sub-file granularity) for v2 of this change**. v1 ships with Pass 1 (service) and Pass 2 (file) only. The `passNumber: 1 | 2 | 3` and `granularity: 'sub-file'` types are present in v1 for forward compatibility but no v1 code path invokes Pass 3. v2 will expose it via a `--granularity=sub-file` CLI flag and ship its own LLM budget.
- Add `SchemaRouter` that reads the existing `DecompositionResult` JSON, looks at the `schemaVersion` field, and routes to the v1 parser (legacy) or v2 parser (new).
- Add a v2 JSON schema (`schemas/decomposition-v2.json`) that is breaking vs v1: `parallelBatches`, `dependencyDAG.edges`, `minCutResult`, and `workUnits` are removed and replaced by per-pass `slices` + `internalEdges` + cross-pass `crossPassEdges`.
- Add CLI flag `--granularity=service|file|both|auto` to `peaks slice decompose` (default: `both`, which is the v2 multi-pass default).
- Add tests for each new component plus integration tests for 3 fixture scenarios (chain, diamond, 3-level-deep).
- Update `peaks slice pick` and `peaks slice plan` to consume v2 schema via `SchemaRouter` (additive change; v1 schema still works).
- **Audit + Goal primitive** (NEW — part of 10% human / 90% LLM paradigm shift):
  - Add `AuditGoalInput` / `AuditGoalOutput` types in a new `src/services/audit/audit-goal-types.ts`.
  - Add `auditGoal(input, llmRunner)` service in `src/services/audit/audit-goal-service.ts` (one LLM call, structured output).
  - Create new top-level skill `peaks-audit` (SKILL.md + reference for the 6 audit dimensions).
  - Update `peaks-solo/SKILL.md` to invoke `peaks-audit` immediately after need expression, and gate autonomous execution on goal approval.
  - Explicitly note in `peaks-slice-decompose/SKILL.md` that this skill is invoked AFTER audit + goal approval.

## Out of Scope

- LLM-driven decomposition (only LLM 兜底 for edge arbitration).
- Cross-package / cross-repo slice topology.
- Real-time incremental updates to the dependency graph (cache invalidation deferred to v2 of this change).
- Replacing the existing 6-stage algorithm — it stays as Pass 1's inner loop and is also reachable via the v1 schema path.
- Schema migration tooling for v1 → v2 conversion; old files are read but not rewritten.
- Removing or renaming any v1 schema field — v1 readers must keep working.

## Dependencies

- Existing `slice-decompose-service.ts` (unchanged, used as inner loop for each Pass).
- Existing `slice-decompose-types.ts` (unchanged, all v1 types preserved).
- Existing `slice-dag.ts` `topologicalLevels` (reused for per-pass topo sort).
- Parallel work: peaks-solo fan-out architecture (out of scope here, but consumes v2 output).

## Risks

- **Latency**: cross-pass edge merger adds ~2-5s per invocation. Mitigated by LLM call budget (max 2) and a conservative fallback path that emits a valid (if pessimistic) topology when merger fails.
- **Breaking JSON change**: any script the user has written against v1 schema needs to update. Mitigated by SchemaRouter keeping v1 readers functional and by the single-user context (no external consumers).
- **LLM non-determinism**: same input can produce different output. Mitigated by content-hash keyed cache so identical prompts hit the cache.
- **Over-decomposition**: too many sub-slices make fan-out overhead exceed parallelism benefit. Mitigated by the granularity decider's stop condition (file count + LoC threshold).
- **Test fixture rework**: existing 6-stage tests still pass; new tests need fresh fixtures. Mitigated by reusing existing 6-stage tests verbatim and adding 5 new multi-pass test cases.
- **Schema router silent fallback**: if a v2 file is read by an old CLI without schema awareness, behavior is undefined. Mitigated by emitting a `schemaVersion` warning at read time and an explicit `UnknownSchemaVersionError` for unrecognised values.

## Acceptance Criteria

- `peaks slice decompose --granularity=both` (default) produces a v2 JSON file with at least 2 passes when the input spans multiple services; falls back to a single Pass 2 (file-level) when service boundaries cannot be detected.
- `peaks slice decompose --granularity=service` produces a v2 JSON with only Pass 1; passes 2 and 3 are omitted.
- `peaks slice decompose --granularity=file` produces a v2 JSON with only Pass 2 (legacy v1-equivalent flat output, but in v2 schema shape).
- `peaks slice decompose --granularity=auto` invokes `GranularityDecider` and LLM tie-breaker ≤ 1 call.
- CrossPassEdgeMerger detects at least 1 type-sharing edge when run against `src/services/config/` (peaks-cli real codebase).
- LLMArbitrator emits ≤ 2 calls per `peaks slice decompose` invocation; emits a warning when budget is exhausted.
- SchemaRouter reads both v1 and v2 files; emits `UnknownSchemaVersionError` for unrecognised versions.
- Existing 6-stage tests (`tests/unit/slice/slice-decompose-service.test.ts`) continue to pass without modification.
- Each new file has ≥ 80% test coverage.
- `pnpm test`, `pnpm typecheck`, and `pnpm test:coverage` all pass.
- Mutation probes (3, per peaks-cli Plan 4 convention): each new module survives at least 1 mutation probe.