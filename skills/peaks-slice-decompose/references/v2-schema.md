# v2 schema — `DecompositionResultV2`

Source of truth: `src/services/slice/slice-topology-types.ts` (W2 T6). All fields are `readonly`. `peaks slice decompose` with a non-default `--granularity` emits this envelope; the default `both` keeps the v1 `DecompositionResult` (see `slice-decompose-types.ts`).

The CLI serialises via `SchemaRouter.writeResult()` → `JSON.stringify(result, null, 2)`.

## Discriminator

| Field | Type | Value | Purpose |
|---|---|---|---|
| `schemaVersion` | literal | `'v2'` | Read-side router branches on this. v1 files have the field absent. |

## Top-level envelope — `DecompositionResultV2`

| Field | Type | Source | Notes |
|---|---|---|---|
| `schemaVersion` | `'v2'` | orchestrator | Discriminator. |
| `rid` | `string` | CLI arg | Echoes the input request id. |
| `generatedAt` | `string` | `new Date().toISOString()` | ISO 8601 UTC, e.g. `2026-06-25T12:00:00.000Z`. |
| `passes` | `readonly PassResult[]` | `MultiPassOrchestrator.decompose` | Ordered: Pass 1 first (if requested), then Pass 2 (one entry per qualifying parent). Length: 0–N. |
| `crossPassEdges` | `readonly CrossPassEdge[]` | `cross-pass-edge-merger.ts` (via `merge`) | Empty when `opts.llmRunner` is not provided. |
| `llmArbitrations` | `readonly LlmArbitration[]` | `merge.llmCalls` mapped via `llmCallsToArbitrations` | Empty when no LLM call was made. Cap: ≤ 2 calls per invocation. |
| `codegraph` | `CodegraphEnvelope` | from Pass 1 / Pass 2 result | Reused from v1 (see `slice-decompose-types.ts`). Falls back to `zeroCodegraph()` if neither pass ran. |
| `understandAnything` | `UnderstandAnythingEnvelope` | from Pass 1 / Pass 2 result | Reused from v1. Falls back to `zeroUnderstand()` if neither pass ran. |
| `partial` | `boolean` | orchestrator | `true` iff any pass failed to complete. Currently always `false` from `MultiPassOrchestrator`; reserved for future partial-failure paths. |

## `CodegraphEnvelope` (re-exported from v1)

| Field | Type | Notes |
|---|---|---|
| `nodes` | `number` | Codegraph node count at the time of decomposition. |
| `edges` | `number` | Codegraph edge count. |
| `dbMB` | `number` | Codegraph database size. |
| `freshness` | `string` | Git SHA at which the index was built, or `'unindexed'`. |
| `affectedCrossFile` | `boolean` | `true` iff `codegraph.affected` reported > 0 cross-file dependents. |
| `note` | `string` | Free-form operator note; `'no decomposition run'` when both passes were skipped. |

## `UnderstandAnythingEnvelope` (re-exported from v1)

| Field | Type | Notes |
|---|---|---|
| `kgNodes` | `number` | Knowledge-graph node count. |
| `kgEdges` | `number` | Knowledge-graph edge count. |
| `available` | `boolean` | `false` when the `.understand-anything/knowledge-graph.json` file is missing. |
| `fallback` | `'semantic' \| 'structural-only'` | `'structural-only'` when `available` is `false`. |
| `note` | `string` | Free-form note. |

## `PassResult`

| Field | Type | Notes |
|---|---|---|
| `passNumber` | `PassNumber` (`1 \| 2 \| 3`) | `3` reserved for future sub-file pass. |
| `granularity` | `SliceGranularity` (`'service' \| 'file' \| 'sub-file'`) | The granularity the pass was run at. |
| `slices` | `readonly SliceV2[]` | One entry per discovered slice. Length: 0–N. |
| `internalEdges` | `readonly InternalEdge[]` | Always `[]` in current `MultiPassOrchestrator`. Reserved for future within-pass edges. |

### `SliceV2`

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Stable id within the pass. Pass 1: `"W1".."Wn"`. Pass 2: `"<parent.id>.<i+1>"`, e.g. `"W1.3"`. |
| `label` | `string` | Human-readable; shown in `peaks slice pick` fzf list (v1 only — current pick consumes v1 envelopes). |
| `granularity` | `SliceGranularity` | Matches the enclosing `PassResult.granularity`. |
| `files` | `readonly string[]` | Project-relative paths. |
| `loc` | `number` | Total LoC across all `files`. |
| `parentSliceId` | `string \| null` | `null` for Pass 1. For Pass 2, the id of the parent Pass 1 slice. |
| `semanticAnchor` | `string` | `"domain:<name>"` when understand-anything indexed, else `"file:<path>"`. Currently always `"file:<wu.filePath>"` from the orchestrator's `workUnitToSliceV2`. |

### `InternalEdge` (reserved)

| Field | Type | Notes |
|---|---|---|
| `from` | `string` | SliceV2 id. |
| `to` | `string` | SliceV2 id. |
| `kind` | `InternalEdgeKind` (`'imports' \| 'calls' \| 'depends_on' \| 'contains_flow' \| 'flow_step'`) | Within-pass edge kind. |
| `weight` | `number` | Downstream min-cut / dispatch-ordering heuristic input. |
| `evidence` | `string` | The actual import statement or graph edge. |
| `confidence` | `EdgeConfidence` (`'structural' \| 'semantic'`) | Source of the edge. |

> **Note:** `MultiPassOrchestrator` always emits `internalEdges: []`. This contract is reserved for a future within-pass edge detector; v2 consumers must tolerate an empty array.

## `CrossPassEdge`

| Field | Type | Notes |
|---|---|---|
| `fromPass` | `PassNumber` | The upper (coarser) pass number. |
| `toPass` | `PassNumber` | The lower (finer) pass number. Always `fromPass < toPass`. |
| `fromSliceId` | `string` | Slice id in `fromPass`. |
| `toSliceId` | `string` | Slice id in `toPass`. |
| `kind` | `CrossPassEdgeKind` (`'type-shares' \| 'fixture-shares' \| 'import-re-export' \| 'llm-arbitrated'`) | See `references/cross-pass-edge-interpretation.md`. |
| `confidence` | `EdgeConfidence \| 'llm'` | `'llm'` only when `kind === 'llm-arbitrated'`. Structural detectors emit `'structural'`. |
| `evidence` | `string` | Human-readable: the import line, the shared fixture id, or `llm:<callId>: <reason>` for LLM edges. |
| `arbitratedBy` | `string \| null` | The `LlmArbitration.callId` that produced this edge, or `null` for static-detected edges. |

### `arbitratedBy` discriminator

| Value | Meaning |
|---|---|
| `null` | Edge was emitted by a static detector (`type-shares` / `fixture-shares` / `import-re-export`). |
| `string` (a `callId`) | Edge was emitted by the LLM fallback (`kind === 'llm-arbitrated'`). The `callId` is a foreign key into `llmArbitrations[].callId`. |

If `kind === 'llm-arbitrated'` then `arbitratedBy` MUST be a non-null `callId`. If `kind !== 'llm-arbitrated'` then `arbitratedBy` MUST be `null`. The CLI does not enforce this at the type level (TypeScript's structural typing allows mismatches) — downstream consumers may assert.

## `LlmArbitration`

| Field | Type | Notes |
|---|---|---|
| `callId` | `string` | Stable id within the invocation. Referenced by `CrossPassEdge.arbitratedBy`. |
| `promptHash` | `string` | sha256 hex of the prompt; used for content-hash cache lookup. Currently `''` (empty string) when produced via `MultiPassOrchestrator` — see `llmCallsToArbitrations`. |
| `input` | `string` | The actual prompt sent to the LLM. Currently `''` (empty string) when produced via `MultiPassOrchestrator`. |
| `output` | `string` | The raw LLM response. Currently `''` (empty string) when produced via `MultiPassOrchestrator`. |
| `confidence` | `LlmConfidence` (`'high' \| 'medium' \| 'low'`) | Currently always `'low'` when produced via `MultiPassOrchestrator`. Real values land when the merger surfaces the full trace (W5+). |
| `tokens` | `{ input: number; output: number }` | Token count for the call. Coalesced to `{ input: 0, output: 0 }` when the underlying trace carries `null`. |

> **Implication for audit:** consumers that need to inspect the actual prompt or response currently see empty strings for `LlmArbitration` produced by `MultiPassOrchestrator`. Use `callId` as a foreign key into a future side-channel trace, or wait for the W5+ merger upgrade that fills these fields.

## Type unions (quick reference)

```ts
export type SchemaVersion = 'v1' | 'v2';
export type SliceGranularity = 'service' | 'file' | 'sub-file';
export type PassNumber = 1 | 2 | 3;
export type EdgeConfidence = 'structural' | 'semantic';
export type LlmConfidence = 'high' | 'medium' | 'low';
export type InternalEdgeKind =
  | 'imports' | 'calls' | 'depends_on' | 'contains_flow' | 'flow_step';
export type CrossPassEdgeKind =
  | 'type-shares' | 'fixture-shares' | 'import-re-export' | 'llm-arbitrated';
```

## Read path (BLOCKING)

```ts
import { readResult } from '../../services/slice/schema-router.js';

const parsed = readResult(outPath);
if (parsed.schemaVersion === 'v2') {
  // typed as DecompositionResultV2
} else {
  // typed as DecompositionResult (v1)
}
```

`SchemaRouter.readResult()` throws `UnknownSchemaVersionError` (code `UNKNOWN_SCHEMA_VERSION`) for any other `schemaVersion` value. The CLI maps that to exit code 1 with a `nextActions` hint. Do not swallow the error — the file may be a partial write from a crashed orchestrator.

## Schema migration contract

Any future schema change MUST:

1. Add a new `SchemaVersion` literal (`'v3'` etc.).
2. Extend `SchemaRouter.readResult()` to accept and dispatch it.
3. Bump `DecompositionResultV3.schemaVersion: 'v3'`.
4. Keep the v2 reader path intact (no in-place rewrite of v2 files).
5. Update this reference + add a `references/v3-schema.md`.

In-place edits to v1/v2 fields are forbidden: any consumer that already wrote a v2 file expects its schema to remain stable.