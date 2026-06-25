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

## 8. Documentation + standards

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