# Design: add-slice-topology-multipass

## Goal

Enable `peaks slice decompose` to produce hierarchical multi-pass slice topology that supports peaks-solo fan-out RD. Each Pass is one invocation of the existing 6-stage algorithm at a fixed granularity; Passes are layered (service → file → optional sub-file) and joined by a cross-pass edge merger with strict LLM 兜底.

## Architecture

```
   peaks slice decompose [--granularity=service|file|both|auto]
       │
       ▼
   MultiPassOrchestrator  (NEW; ~150 LoC)
       │  decides pass count + granularity per pass
       ▼
   ┌──────────────┐  ┌──────────────┐
   │ Pass 1       │  │ Pass 2       │
   │ granularity  │  │ granularity  │
   │   = service  │  │   = file     │
   │              │  │ (per service │
   │              │  │  in parallel)│
   └──────┬───────┘  └──────┬───────┘
          │                 │
          └────────┬────────┘
                   │  Pass 3 (sub-file) reserved for v2 of this change;
                   │  data model is forward-compatible (passNumber:
                   │  1 | 2 | 3) but no v1 code path invokes it.
                   │
                   ▼
                   │                 │
                   ▼                 ▼
          CrossPassEdgeMerger  (NEW; ~200 LoC)
                   │   - type sharing
                   │   - test-fixture sharing
                   │   - import re-export sharing
                   │   - LLM 兜底 (≤ 2 calls total)
                   ▼
          SchemaRouter.write  (NEW; ~50 LoC)
                   │   schemaVersion = "v2" → v2 write
                   │   schemaVersion = "v1" → v1 write (legacy)
                   ▼
          .peaks/sc/slice-decomposition/<rid>.json
```

Each Pass internally calls `decomposeSlices()` from `src/services/slice/slice-decompose-service.ts` (UNCHANGED), passing a pass-specific `granularity` option. The existing 6-stage algorithm is the inner loop; the orchestrator only adds recursion and cross-pass joining.

## Audit + Goal Primitive (10/90 paradigm gate)

The 10% human / 90% LLM model requires a structured **audit + goal** step between human need expression and autonomous LLM execution. Without this gate, the human would have to iterate, which defeats the 10/90 model.

### Why this lives BEFORE slice decomposition

| Step | Owner | Purpose |
|---|---|---|
| Need expression | Human | One-shot natural language input |
| Audit + goal | LLM (autonomous) | Multi-dim audit + goal proposal |
| Goal approval | Human | One-shot acceptance check |
| Slice decomposition | LLM (autonomous) | This change's algorithm |
| RD / QA / verify | LLM (autonomous) | Implementation and verification |
| Final acceptance | Human | Review final delivery |

Audit + goal is the **last gate where the human's understanding of the need is canonicalized**. After goal approval, all subsequent work is the LLM's responsibility.

### Data Model

```ts
interface AuditGoalInput {
  readonly need: string;                    // Human's natural language expression
  readonly context?: {
    readonly projectRoot?: string;
    readonly sessionMemory?: readonly string[];
    readonly relevantMemories?: readonly string[];
  };
}

interface AuditDimension {
  readonly dimension: 'correctness' | 'completeness' | 'scope' | 'risks' | 'alternatives' | 'constraints';
  readonly finding: string;                 // 1-3 sentence finding
  readonly severity: 'info' | 'concern' | 'blocker';
}

interface AuditGoalOutput {
  readonly summary: string;                 // 1-2 sentence summary of the need
  readonly audit: readonly AuditDimension[]; // Exactly 6 dimensions
  readonly proposedGoal: string;            // What success looks like
  readonly successCriteria: readonly string[]; // Acceptance criteria for final acceptance
  readonly roughEffort: 'small' | 'medium' | 'large' | 'epic';
  readonly confidence: 'high' | 'medium' | 'low';
  /** LLM-rendered one-paragraph rationale tying audit → goal → criteria. */
  readonly rationale: string;
}
```

### 6 audit dimensions (mandatory — LLM must fill all 6)

1. **Correctness**: Is the problem stated correctly? Are we solving the right thing? Common failure: solving the symptom, not the root cause.
2. **Completeness**: Are all aspects of the need covered? Edge cases? Implicit assumptions that should be explicit?
3. **Scope**: Is the scope reasonable? Too big (should be split)? Too small (over-engineering for trivial case)?
4. **Risks**: What could go wrong? Technical risks, dependency risks, schedule risks?
5. **Alternatives**: Are there better approaches? What did we consider and reject? Why?
6. **Constraints**: Hard constraints (must use existing API, can't change schema, etc.)? Soft constraints (preference for one approach)?

### Algorithm

```ts
async function auditGoal(input: AuditGoalInput, llmRunner: LlmRunner): Promise<AuditGoalOutput>;
```

1. Build a structured prompt: "Audit the following need across 6 dimensions. For each, give a finding and severity. Then propose a goal. Then list success criteria. Then assess rough effort and confidence."
2. Call `llmRunner` with the prompt (one LLM call, no need for 兜底 in v1).
3. Parse the structured output into `AuditGoalOutput`.
4. Validate that all 6 audit dimensions are present; throw if missing.

### One-shot accuracy target

The audit must be **good enough that the human accepts the goal on first review**. Tactics:

- Force all 6 dimensions (no skipping) — surfaces implicit assumptions.
- Require explicit `severity` per dimension — surfaces blockers early.
- Require `confidence` on the overall output — honest signal when LLM is unsure.
- Require `successCriteria` as a list — gives the human something concrete to verify against at final acceptance.

### Where audit + goal lives

Owned by `peaks-solo` (the orchestrator). Invoked immediately after the human expresses the need, BEFORE any PRD / RD / QA work begins. The `peaks-audit` skill (new in this change) documents the audit algorithm and 6 dimensions.

The `peaks-slice-decompose` skill explicitly states it is invoked AFTER audit + goal approval.

## Skill Layer (LLM-facing operation manual)

In peaks-cli's architecture, **skills are the LLM's operation manuals for the CLI**. The CLI exposes atomic primitives; the skill tells the LLM when to invoke which primitive and how to interpret the output. This change introduces both — without the skill layer, peaks-solo / peaks-rd / peaks-qa cannot discover or correctly use the new multi-pass algorithm.

### New skill: `peaks-slice-decompose`

A focused skill that documents how to invoke `peaks slice decompose` with the new `--granularity` flag and how to interpret the v2 result. Top-level skill (not a reference under `peaks-sc`) because:

- `peaks-sc` is "slice coordinator" — coordinates multi-step slice planning across PRD/RD/QA. `peaks-slice-decompose` is one specific step (the actual decomposition algorithm). Different concerns.
- peaks-cli convention: each role/feature ships as a top-level skill (peaks-prd, peaks-qa, peaks-rd, peaks-ui, peaks-companion, peaks-doctor, peaks-ide are all top-level). A new feature warrants a new skill.
- LLM discoverability: the skill name matches the LLM's likely intent ("decompose this PRD into slices").

Layout:

```
skills/peaks-slice-decompose/
├── SKILL.md                                          ← entry, 50-80 lines
└── references/
    ├── v2-schema.md                                  ← DecompositionResultV2 field-by-field reference
    ├── granularity-decision.md                       ← when to use service|file|both|auto (decision tree)
    └── cross-pass-edge-interpretation.md             ← how downstream agents read crossPassEdges for dispatch ordering
```

`SKILL.md` MUST cover:

- **Trigger conditions**: when the LLM should invoke this skill (PRD ready, slice plan needed, no existing decomposition in `.peaks/sc/slice-decomposition/<rid>.json`).
- **Granularity options**: the 4 values (`service`, `file`, `both`, `auto`) with their semantics and default (`both`).
- **Output shape**: high-level v2 JSON structure (passes[], crossPassEdges, llmArbitrations) without dumping every field.
- **Reading the result**: `SchemaRouter.readResult(<path>)` is the canonical reader; raw JSON parsing is forbidden.
- **Cross-references**: when this skill hands off to peaks-rd (for sub-agent dispatch) and peaks-qa (for verification).

### Updated skills (additive, no breaking changes to existing SKILL.md content)

| Skill | Reference to add | What it tells the LLM |
|---|---|---|
| `peaks-solo/SKILL.md` | Link to `peaks-slice-decompose/SKILL.md` in the "slice planning" section | When Solo orchestrates a multi-slice task, dispatch to `peaks-slice-decompose` first |
| `peaks-rd/SKILL.md` | New `references/reading-v2-slice-results.md` | How RD reads the v2 JSON and plans sub-agent dispatch per pass |
| `peaks-qa/SKILL.md` | New `references/cross-pass-edge-verification.md` | How QA verifies that a multi-pass plan was executed with the right cross-pass ordering |
| `peaks-prd/SKILL.md` | New `references/prd-for-multi-pass.md` | How PRD authors write acceptance criteria that yield clean slice boundaries |
| `peaks-sc/SKILL.md` | Link to `peaks-slice-decompose/SKILL.md` | Slice coordinator's first step is the decomposition skill |

### Skill vs CLI: who owns what

| Concern | Owner | Rationale |
|---|---|---|
| Algorithm logic (multi-pass, cross-pass merger, LLM 兜底) | CLI (TypeScript modules) | Deterministic, testable, fast |
| Schema (v2 JSON shape, breaking changes) | CLI (emits) + Skill (documents) | Schema is CLI-emitted, but LLM needs the skill to know the shape |
| When to invoke | Skill (LLM judgment) | Algorithmic heuristics live in skill decision trees, not CLI |
| How to interpret output | Skill (LLM guidance) | Field semantics + cross-pass edge ordering rules |
| Cache key + budget for LLM 兜底 | CLI (LLMArbitrator) | Mechanical, deterministic |
| When to invoke LLM 兜底 vs static analysis | CLI (CrossPassEdgeMerger) | Algorithmic decision, not LLM judgment |

## Data Model

### Public types (new file `src/services/slice/slice-topology-types.ts`)

```ts
/** Schema version discriminator. v1 readers ignore v2 extras; v2 readers route by this field. */
export type SchemaVersion = 'v1' | 'v2';

/** Pass-level configuration. */
export interface PassConfig {
  readonly passNumber: 1 | 2 | 3;
  readonly granularity: 'service' | 'file' | 'sub-file';
  /** Optional scope filter — when set, only WUs touching these files are decomposed at this pass. */
  readonly scopeFilter?: readonly string[];
}

/** Single slice in v2 schema. */
export interface SliceV2 {
  readonly id: string;                       // e.g. "S1" (pass 1) or "F1.1" (pass 2)
  readonly label: string;                    // human-readable
  readonly granularity: 'service' | 'file' | 'sub-file';
  readonly files: readonly string[];         // project-relative paths
  readonly loc: number;                      // sum of file LoC
  readonly parentSliceId: string | null;     // null for top-level (pass 1)
  readonly semanticAnchor: string;           // codegraph node id or "file:<path>"
}

/** Edge within a single Pass. */
export interface InternalEdge {
  readonly from: string;                     // SliceV2 id
  readonly to: string;                       // SliceV2 id
  readonly kind: 'imports' | 'calls' | 'depends_on' | 'contains_flow' | 'flow_step';
  readonly weight: number;
  readonly evidence: string;
  readonly confidence: 'semantic' | 'structural';
}

/** Edge between slices in adjacent Passes. */
export interface CrossPassEdge {
  readonly fromPass: 1 | 2 | 3;
  readonly toPass: 1 | 2 | 3;
  readonly fromSliceId: string;
  readonly toSliceId: string;
  readonly kind: 'type-shares' | 'fixture-shares' | 'import-re-export' | 'llm-arbitrated';
  readonly confidence: 'structural' | 'semantic' | 'llm';
  readonly evidence: string;
  /** When kind === 'llm-arbitrated', the LLMArbitrator callId that produced this edge. */
  readonly arbitratedBy: string | null;
}

/** LLM 兜底 call record. */
export interface LlmArbitration {
  readonly callId: string;
  readonly promptHash: string;               // sha256 of (system + user) for caching
  readonly input: string;
  readonly output: string;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly tokens: { input: number; output: number };
}

/** One Pass's output. */
export interface PassResult {
  readonly passNumber: 1 | 2 | 3;
  readonly granularity: 'service' | 'file' | 'sub-file';
  readonly slices: readonly SliceV2[];
  readonly internalEdges: readonly InternalEdge[];
}

/** v2 decomposition result (breaking vs v1). */
export interface DecompositionResultV2 {
  readonly schemaVersion: 'v2';
  readonly rid: string;
  readonly generatedAt: string;              // ISO-8601
  readonly passes: readonly PassResult[];
  readonly crossPassEdges: readonly CrossPassEdge[];
  readonly llmArbitrations: readonly LlmArbitration[];
  readonly codegraph: CodegraphEnvelope;     // re-used from v1 types
  readonly understandAnything: UnderstandAnythingEnvelope;
  /** True if any Pass returned incomplete data; downstream should return-to-rd. */
  readonly partial: boolean;
}
```

### Breaking changes vs v1

| v1 field | v2 equivalent | Notes |
|---|---|---|
| `workUnits` | `passes[].slices` (typed `SliceV2[]`) | Each slice has `parentSliceId` for hierarchy. |
| `dependencyDAG.edges` | `passes[].internalEdges` + `crossPassEdges` | Edges split by which Pass they belong to. |
| `parallelBatches` | Derived at read time via `topologicalLevels` on `internalEdges` + `crossPassEdges` | Re-derive, don't store. |
| `sccAnalysis` | Removed in v2 (was a v1 algorithm debug field) | Re-derive on demand if needed. |
| `criticalPath` | Removed in v2 (was a v1 algorithm debug field) | Re-derive on demand if needed. |
| `minCutResult` | Removed in v2 (was v1 simplified; never used downstream) | Gone. |

`codegraph` and `understandAnything` envelopes are unchanged — they're observational metadata.

### LLM 兜底 Budget

| Constraint | Value | Rationale |
|---|---|---|
| Max calls per `peaks slice decompose` | 2 | One for granularity tie-break, one for cross-pass edge arbitration. |
| Per-call input tokens | ≤ 4000 | Fits one focused question + relevant code excerpt. |
| Per-call output tokens | ≤ 1000 | Edge list or granularity decision, both terse. |
| Per-call timeout | 30 s | Beyond this, fall back to conservative topology. |
| Cache key | sha256(systemPrompt + userPrompt) | Identical prompts hit cache; deterministic. |

Budget exhaustion → emit a warning + fall back to conservative topology (all cross-pass edges force sequential). Never throw.

## Component contracts

### `MultiPassOrchestrator.decompose(rid, prdMarkdown, projectRoot, opts)`

```ts
interface OrchestratorOptions {
  granularity: 'service' | 'file' | 'both' | 'auto';
  /** Pass 3 only when true; default false. */
  enableSubFilePass?: boolean;
  /** LLM runner for tie-break + arbitration. Injected for tests. */
  llmRunner?: LlmRunner;
}

async function decompose(
  rid: string,
  prdMarkdown: string,
  projectRoot: string,
  opts: OrchestratorOptions
): Promise<DecompositionResultV2>;
```

Behavior:
1. Parse PRD acceptance criteria.
2. If `granularity === 'service'` → only Pass 1.
3. If `granularity === 'file'` → only Pass 2 (flat, equivalent to v1's behavior).
4. If `granularity === 'both'` → Pass 1, then Pass 2 inside each Pass 1 slice whose LoC > 400 OR files > 3.
5. If `granularity === 'auto'` → run Pass 1 first; invoke `GranularityDecider` for each Pass 1 slice; invoke `LLMArbitrator` once if decider is inconclusive.
6. If `enableSubFilePass === true` AND a Pass 2 slice has `loc > 400` → run Pass 3 inside it.
7. Pass 2 and Pass 3 internal calls run in parallel (`Promise.all` over the parent's slices).
8. Pass results feed `CrossPassEdgeMerger.merge()` for cross-pass edges.
9. Result goes through `SchemaRouter.write()`.

### `GranularityDecider.shouldSubdivide(wu)`

```ts
function shouldSubdivide(
  wu: WorkUnit,
  thresholds: { maxFiles: number; maxLoc: number }
): { subdivide: boolean; reason: string };
```

Returns `subdivide: true` when `wu.files.length > thresholds.maxFiles` OR `wu.loc > thresholds.maxLoc`. Default thresholds: `maxFiles: 3`, `maxLoc: 400`.

If borderline (within 20% of threshold), set `subdivide: 'tie-break'` and the orchestrator invokes LLM once.

### `CrossPassEdgeMerger.merge(passes)`

```ts
async function merge(
  passes: readonly PassResult[],
  llmRunner: LlmRunner
): Promise<{
  edges: readonly CrossPassEdge[];
  llmCalls: readonly LlmArbitration[];
}>;
```

Algorithm per adjacent Pass pair (N, N+1):
1. Static type sharing: parse imports of each Pass N+1 file; if it imports a type-only symbol from a Pass N file, add `kind: 'type-shares'` edge.
2. Static fixture sharing: read `vitest.config.ts` `setupFiles`; if a Pass N+1 test imports a setup file referenced by a Pass N test, add `kind: 'fixture-shares'` edge.
3. Static import re-export: if Pass N file does `export * from './foo'` and Pass N+1 file imports `./foo`, add `kind: 'import-re-export'` edge.
4. If any Pass N+1 slice has zero cross-pass edges AND `files.length > 1` → mark "ambiguous"; invoke `LLMArbitrator` once with: "Does slice X have a logical dependency on any slice in Pass N? List edges or 'none'."
5. Aggregate all edges + LLM calls. Return.

LLM budget check: if `llmCalls.length >= 2`, skip step 4 for remaining ambiguous slices and emit a warning.

### `LLMArbitrator.arbitrate(prompt)`

```ts
interface LlmRunner {
  call(systemPrompt: string, userPrompt: string, opts: { maxTokens: number }): Promise<{ output: string; tokens: { input: number; output: number } }>;
}

interface ArbitratorOptions {
  cacheDir: string;                          // disk cache for content-hash keyed responses
  maxCallsPerInvocation: number;             // default 2
  perCallTimeoutMs: number;                  // default 30000
  llmRunner: LlmRunner;                      // injected
}

async function arbitrate(
  prompt: string,
  opts: ArbitratorOptions
): Promise<{ output: string | null; callId: string; tokens: { input: number; output: number } | null }>;
```

Behavior:
1. Compute `promptHash = sha256(prompt)`.
2. If `cacheDir/<promptHash>.json` exists → return cached response, increment cache-hit counter.
3. If `callsThisInvocation >= opts.maxCallsPerInvocation` → return `{ output: null, callId: 'budget-exhausted', tokens: null }`.
4. Call `opts.llmRunner.call(prompt, prompt, { maxTokens: 1000 })` with a 30 s timeout.
5. On success → write `cacheDir/<promptHash>.json`; return response.
6. On timeout / error → return `{ output: null, callId: 'timeout' | 'error', tokens: null }`.

### `SchemaRouter`

```ts
function readResult(filePath: string): DecompositionResult | DecompositionResultV2;
function writeResult(filePath: string, result: DecompositionResult | DecompositionResultV2): void;
```

- `readResult`: parse the file, read `schemaVersion`, dispatch to v1 or v2 parser.
- `writeResult`: v2 results write with `"schemaVersion": "v2"` field; v1 results write unchanged (no schemaVersion field).
- `UnknownSchemaVersionError`: thrown when `schemaVersion` is present but neither 'v1' nor 'v2'.

## Data Flow

```
PRD markdown (acceptance criteria text)
   │
   ▼
MultiPassOrchestrator.decompose(rid, prdMarkdown, projectRoot, {granularity, llmRunner})
   │
   ├── Pass 1: decomposeSlices(rid, prdMarkdown, projectRoot, {granularity: 'service'})
   │           returns ServiceSlice[] (mapped to SliceV2 with granularity='service')
   │
   ├── For each ServiceSlice with loc>400 OR files>3:
   │   Pass 2 (parallel): decomposeSlices(rid, '', projectRoot, {granularity: 'file', scopeFilter: slice.files})
   │                      returns FileSlice[] (mapped to SliceV2 with granularity='file', parentSliceId=service.id)
   │
   │  (Pass 3 — sub-file granularity — reserved for v2 of this change;
   │   data model is forward-compatible (passNumber: 1 | 2 | 3) but no v1 code path invokes it.)
   │
   ├── CrossPassEdgeMerger.merge(passes, llmRunner)
   │   - type shares + fixture shares + import re-export (structural)
   │   - LLM 兜底 for ambiguous slices (≤ 2 calls)
   │
   └── SchemaRouter.write(.peaks/sc/slice-decomposition/<rid>.json, result)
```

## Error Handling

| Failure Mode | Behavior | User-visible signal |
|---|---|---|
| Pass 1 finds no service boundaries (graph too small) | Degrade to 1-Pass mode (Pass 2 only, file-level flat) | `partial: true`, `llmArbitrations` empty |
| Pass 2 finds no shared types in a service | No error (means files are genuinely independent) | n/a |
| CrossPassEdgeMerger ambiguous | LLM 兜底 1 call; if still ambiguous → conservative topo (all cross-pass edges force sequential) | `llmArbitrations` records the call + its `confidence` |
| LLM 兜底 fails (network / budget / timeout) | Emit partial result with `partial: true` and warning | `partial: true`, warning in CLI stderr |
| Schema router can't identify version | Throw `UnknownSchemaVersionError` | CLI exits non-zero with error message pointing to `peaks slice migrate` (future) |
| Existing 6-stage algorithm throws | Bubble up; orchestrator catches and emits partial result | CLI exits non-zero with `partial: true` |
| Concurrent Pass 2 / Pass 3 invocations race on shared cache | Use file locking on cache writes; read-side ignores lock | n/a |

## Migration / Compatibility

- **v1 → v2**: no automatic migration. v1 files remain readable by `SchemaRouter.readResult()`.
- **CLI behavior**: `peaks slice decompose` writes v2 by default (since the algorithm is multi-pass). `--granularity=file` produces v2-shape but flat (single Pass 2).
- **Downstream consumers**: `peaks slice pick`, `peaks slice plan` updated to use `SchemaRouter.readResult()`. They handle both versions.
- **Old CLIs reading v2 files**: emit a warning at read time; fields they don't understand are ignored.

## Testing Strategy

### Per-component unit tests (≥ 80% coverage each)

- `MultiPassOrchestrator`: 4 fixtures (single-Pass, 2-Pass, 3-Pass, ambiguous). Mock `decomposeSlices` and `LLMArbitrator`.
- `CrossPassEdgeMerger`: 5 fixtures (type-shares detected, fixture-shares detected, import-re-export detected, LLM-arbitrated, all-ambiguous). Mock `LLMArbitrator`.
- `GranularityDecider`: 6 fixtures (small WU, large WU, borderline, multi-file, edge-of-threshold).
- `LLMArbitrator`: 5 fixtures (cache hit, cache miss + success, timeout, budget exhausted, runner error). Mock `LlmRunner`.
- `SchemaRouter`: 4 fixtures (read v1, read v2, write v1, write v2, unknown version).

### Integration tests

- Run `MultiPassOrchestrator` end-to-end on `src/services/config/` (peaks-cli real codebase, ~14 files, has type-sharing). Assert v2 output structure.
- Run on `src/services/memory/` (3 sibling files after the recent split). Assert 2-Pass output.

### Mutation probes (3, per Plan 4)

- Probe A: comment out `CrossPassEdgeMerger`'s type-sharing detection. Assert ≥ 1 integration test fails.
- Probe B: change `GranularityDecider` thresholds from `>` to `>=`. Assert ≥ 1 fixture test fails.
- Probe C: remove `LLMArbitrator` cache lookup. Assert cache-hit fixture test fails (latency assertion).

## File Layout

```
src/services/slice/
├── multi-pass-orchestrator.ts          (NEW, ~150 LoC)
├── cross-pass-edge-merger.ts           (NEW, ~200 LoC)
├── granularity-decider.ts              (NEW, ~80 LoC)
├── llm-arbitrator.ts                   (NEW, ~100 LoC)
├── schema-router.ts                    (NEW, ~50 LoC)
├── slice-topology-types.ts             (NEW, ~120 LoC)
├── slice-decompose-service.ts          (UNCHANGED, ~776 LoC)
├── slice-decompose-types.ts            (UNCHANGED, ~275 LoC)
└── (existing files unchanged)

schemas/
├── decomposition-v1.json               (NEW, ~100 LoC; extracted from current types)
└── decomposition-v2.json               (NEW, ~200 LoC)

tests/unit/slice/
├── multi-pass-orchestrator.test.ts     (NEW)
├── cross-pass-edge-merger.test.ts      (NEW)
├── granularity-decider.test.ts         (NEW)
├── llm-arbitrator.test.ts              (NEW)
├── schema-router.test.ts               (NEW)
└── integration/
    └── slice-decompose-e2e.test.ts     (NEW; runs against peaks-cli real codebase)

Total new code: ~700 LoC production + ~800 LoC tests = ~1500 LoC.
```

## Open Questions

None — all design points resolved through the brainstorm conversation on 2026-06-25.