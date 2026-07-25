# Spec Delta: slice-topology

> Companion to `proposal.md` and `design.md` in this change. Formalises the v2 multi-pass slice topology contract as Given/When/Then scenarios. The implementation-level details live in `design.md`; this file is the executable spec delta.

## ADDED Requirements

### Requirement: Multi-pass slice decomposition command

The CLI SHALL provide `peaks slice decompose [--granularity=service|file|both|auto]` to produce a v2 hierarchical slice topology.

#### Scenario: Default granularity produces 2-Pass output

- **GIVEN** a project with at least 2 service directories in `src/services/`
- **AND** at least one service has `loc > 400` or `files > 3`
- **WHEN** the user runs `peaks slice decompose --rid <rid>` with no `--granularity` flag
- **THEN** the command defaults to `--granularity=both`
- **AND** produces a v2 JSON file at `.peaks/sc/slice-decomposition/<rid>.json`
- **AND** the JSON has `schemaVersion: "v2"`
- **AND** `passes.length === 2` (Pass 1 = service-level, Pass 2 = file-level)
- **AND** Pass 2 slices have `parentSliceId` pointing to a Pass 1 slice
- **AND** `crossPassEdges.length >= 0` (detected type/fixture/import-re-export edges)

#### Scenario: `--granularity=service` produces single-Pass output

- **GIVEN** any project state
- **WHEN** the user runs `peaks slice decompose --rid <rid> --granularity=service`
- **THEN** the v2 JSON has `passes.length === 1`
- **AND** the only pass is Pass 1 (service-level)
- **AND** no Pass 2 sub-slices are computed

#### Scenario: `--granularity=file` produces flat single-Pass output

- **GIVEN** any project state
- **WHEN** the user runs `peaks slice decompose --rid <rid> --granularity=file`
- **THEN** the v2 JSON has `passes.length === 1`
- **AND** the only pass is Pass 2 (file-level, flat)
- **AND** `passes[0].granularity === "file"`
- **AND** every slice has `parentSliceId === null`

#### Scenario: `--granularity=auto` invokes LLM tie-breaker at most once

- **GIVEN** Pass 1 produces at least one borderline WorkUnit (within 20% of the granularity threshold)
- **WHEN** the user runs `peaks slice decompose --rid <rid> --granularity=auto`
- **THEN** `GranularityDecider.shouldSubdivide()` returns `'tie-break'` for that WorkUnit
- **AND** `LLMArbitrator.arbitrate()` is invoked at most 1 time during this decompose call
- **AND** the LLM tie-breaker output decides whether the WorkUnit is subdivided in Pass 2

### Requirement: Cross-pass edge detection

The `CrossPassEdgeMerger` SHALL detect dependencies between adjacent passes using static analysis, falling back to LLM 兜底 for ambiguous cases.

#### Scenario: Type-sharing edge detected structurally

- **GIVEN** a Pass 1 slice S1 contains file `src/services/config/config-service.ts`
- **AND** a Pass 2 slice F1.1 inside S1 has file `src/services/config/config-nested.ts`
- **AND** `config-nested.ts` imports a type-only symbol from `config-service.ts`
- **WHEN** `CrossPassEdgeMerger.merge(passes, llmRunner)` is called
- **THEN** `edges.length >= 1`
- **AND** at least one edge has `kind === 'type-shares'`
- **AND** `fromSliceId === 'S1'` and `toSliceId === 'F1.1'`
- **AND** `confidence === 'structural'` (no LLM call was made)
- **AND** `llmCalls.length === 0` for this edge

#### Scenario: Ambiguous slice triggers LLM 兜底

- **GIVEN** a Pass 2 slice F2.1 has zero structural cross-pass edges
- **AND** `F2.1.files.length > 1`
- **WHEN** `CrossPassEdgeMerger.merge(passes, llmRunner)` is called
- **THEN** `LLMArbitrator.arbitrate()` is invoked once
- **AND** the resulting edge has `kind === 'llm-arbitrated'`
- **AND** `arbitratedBy` references the LLM call's `callId`
- **AND** `llmCalls.length === 1`

#### Scenario: LLM budget exhausted emits conservative topology

- **GIVEN** 3 ambiguous Pass 2 slices (zero structural cross-pass edges, files > 1)
- **AND** `LLMArbitrator` has already used its 2-call budget earlier in the same decompose invocation
- **WHEN** `CrossPassEdgeMerger.merge(passes, llmRunner)` is called
- **THEN** `llmCalls.length <= 2` total (no further LLM calls)
- **AND** each remaining ambiguous slice gets a `kind === 'llm-arbitrated'` edge with `confidence === 'low'`
- **AND** a warning is emitted: `"LLM 兜底 budget exhausted; emitting conservative topology"`

### Requirement: SchemaRouter v1/v2 dual-read

The `SchemaRouter` SHALL read both v1 and v2 decomposition results, routing by the `schemaVersion` field.

#### Scenario: Read v2 file

- **GIVEN** a JSON file with `schemaVersion: "v2"` at the root
- **WHEN** `SchemaRouter.readResult(filePath)` is called
- **THEN** the returned value is typed `DecompositionResultV2`
- **AND** `result.schemaVersion === "v2"`

#### Scenario: Read v1 file

- **GIVEN** a JSON file WITHOUT a `schemaVersion` field (legacy v1)
- **AND** the file matches the v1 schema shape
- **WHEN** `SchemaRouter.readResult(filePath)` is called
- **THEN** the returned value is typed `DecompositionResult` (v1 type, unchanged)
- **AND** a deprecation warning is logged: `"v1 schema is deprecated; will be removed in v3"`

#### Scenario: Unknown schema version rejected

- **GIVEN** a JSON file with `schemaVersion: "v3"` (unrecognised)
- **WHEN** `SchemaRouter.readResult(filePath)` is called
- **THEN** `UnknownSchemaVersionError` is thrown
- **AND** the error message lists the supported versions: `"v1" | "v2"`

### Requirement: LLM 兜底 budget cap

The `LLMArbitrator` SHALL cap LLM calls per `peaks slice decompose` invocation at 2, with deterministic caching.

#### Scenario: Cache hit short-circuits LLM call

- **GIVEN** a previous invocation computed `promptHash = sha256(prompt)`
- **AND** the cache file `cacheDir/<promptHash>.json` exists
- **WHEN** `LLMArbitrator.arbitrate(prompt, opts)` is called with the same prompt
- **THEN** `opts.llmRunner.call` is NOT invoked
- **AND** the cached `output` is returned
- **AND** `callId` indicates a cache hit (e.g. `cache:<hash>`)

#### Scenario: Budget exhaustion returns null output

- **GIVEN** `callsThisInvocation === opts.maxCallsPerInvocation` (i.e. 2)
- **WHEN** `LLMArbitrator.arbitrate(prompt, opts)` is called
- **THEN** `output === null`
- **AND** `callId === 'budget-exhausted'`
- **AND** no error is thrown

#### Scenario: Runner timeout falls back gracefully

- **GIVEN** `opts.llmRunner.call` does not resolve within `opts.perCallTimeoutMs` (30 s)
- **WHEN** `LLMArbitrator.arbitrate(prompt, opts)` is called
- **THEN** `output === null`
- **AND** `callId === 'timeout'`
- **AND** no error is thrown

### Requirement: Existing 6-stage algorithm unchanged

The `slice-decompose-service.ts` file SHALL remain unmodified by this change.

#### Scenario: v1 algorithm still callable as legacy

- **GIVEN** the v1 algorithm at `src/services/slice/slice-decompose-service.ts`
- **WHEN** any code path imports `decomposeSlices` from this file
- **THEN** the function signature is unchanged: `decomposeSlices(rid, prdMarkdown, projectRoot, options)`
- **AND** existing tests in `tests/unit/slice/slice-decompose-service.test.ts` continue to pass without modification
- **AND** the v1 `DecompositionResult` type at `src/services/slice/slice-decompose-types.ts` is exported unchanged

## MODIFIED Requirements

### Requirement: peaks slice pick and peaks slice plan use SchemaRouter

The `peaks slice pick` and `peaks slice plan` commands SHALL read decomposition results via `SchemaRouter.readResult()` instead of directly parsing the JSON file.

#### Scenario: peaks slice pick on v2 file

- **GIVEN** a v2 JSON file at `.peaks/sc/slice-decomposition/<rid>.json`
- **WHEN** the user runs `peaks slice pick --rid <rid>`
- **THEN** `SchemaRouter.readResult()` is invoked
- **AND** the v2 file is parsed correctly
- **AND** the fzf picker shows Pass 1 + Pass 2 slices in topological order

#### Scenario: peaks slice plan on v1 file (backward compat)

- **GIVEN** a legacy v1 JSON file at `.peaks/sc/slice-decomposition/<rid>.json`
- **WHEN** the user runs `peaks slice plan --rid <rid>`
- **THEN** `SchemaRouter.readResult()` is invoked
- **AND** the v1 file is parsed correctly
- **AND** `peaks request init` is called with the v1 pick as before

## Out of Scope for v1 (deferred to v2 of this change)

- Pass 3 (sub-file granularity) execution path. The data model is forward-compatible (`passNumber: 1 | 2 | 3`, `granularity: 'sub-file'`) but no v1 code path invokes Pass 3.
- Automatic v1 → v2 JSON migration tooling. v1 files remain readable but are not rewritten.
- Real-time incremental cache invalidation for the dependency graph (deferred to v2 of this change).