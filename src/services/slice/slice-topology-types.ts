/**
 * Type envelope for v2 multi-pass slice decomposition.
 *
 * v2 extends the v1 `DecompositionResult` with a `passes[]` array (one entry
 * per decomposition pass) and `crossPassEdges[]` (edges that span passes),
 * plus an `llmArbitrations[]` trace for any LLM calls made during
 * decomposition. The new schema is what `peaks-slice-decompose` (and the
 * new `MultiPassOrchestrator`) emit; v1 files remain readable via the
 * `SchemaRouter` (Task 8) so existing `peaks slice pick` / `peaks slice plan`
 * flows do not break.
 *
 * Conventions:
 * - All fields are `readonly` to enforce immutable construction.
 * - Literal unions (`SchemaVersion`, `PassNumber`, etc.) are preferred over
 *   `enum` so the JSON serialisation is the literal string, not a number.
 * - `CrossPassEdge.confidence` extends the structural|semantic union with
 *   `'llm'` because LLM-arbitrated edges are neither — they were guessed
 *   by an LLM and must carry the arbitration trace via `arbitratedBy`.
 */

import type {
  CodegraphEnvelope,
  UnderstandAnythingEnvelope
} from './slice-decompose-types.js';

/** Schema discriminator. v1 files do NOT carry a `schemaVersion` field. */
export type SchemaVersion = 'v1' | 'v2';

/** How coarse a slice is. */
export type SliceGranularity = 'service' | 'file' | 'sub-file';

/** Pass index. v2 only goes up to Pass 3 (sub-file is reserved for future). */
export type PassNumber = 1 | 2 | 3;

/** Edge source confidence. */
export type EdgeConfidence = 'structural' | 'semantic';

/** LLM-reported confidence of a single arbitration. */
export type LlmConfidence = 'high' | 'medium' | 'low';

/** Edge kinds for edges within a single pass. */
export type InternalEdgeKind = 'imports' | 'calls' | 'depends_on' | 'contains_flow' | 'flow_step';

/** Edge kinds for edges that connect two different passes. */
export type CrossPassEdgeKind = 'type-shares' | 'fixture-shares' | 'import-re-export' | 'llm-arbitrated';

/** Configuration for a single decomposition pass. */
export interface PassConfig {
  readonly passNumber: PassNumber;
  readonly granularity: SliceGranularity;
  /** Optional list of files (or semantic anchors) to scope this pass to. */
  readonly scopeFilter?: readonly string[];
}

/** A single v2 slice, scoped to one pass. */
export interface SliceV2 {
  /** Stable id within this pass (e.g. "S1" for Pass 1, "S1.3" for Pass 2 child of S1). */
  readonly id: string;
  /** Human-readable label; shown in `peaks slice pick` fzf list. */
  readonly label: string;
  readonly granularity: SliceGranularity;
  readonly files: readonly string[];
  /** Total LoC across all `files`. */
  readonly loc: number;
  /** Parent slice id from the previous pass, or null for Pass 1. */
  readonly parentSliceId: string | null;
  /** Domain anchor; "domain:<name>" if understand-anything indexed, else "file:<path>". */
  readonly semanticAnchor: string;
}

/** Edge connecting two slices within the same pass. */
export interface InternalEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: InternalEdgeKind;
  /** Edge weight for downstream min-cut / dispatch-ordering heuristics. */
  readonly weight: number;
  /** Human-readable evidence: the actual import statement or graph edge. */
  readonly evidence: string;
  readonly confidence: EdgeConfidence;
}

/** Edge connecting a slice in one pass to a slice in another pass. */
export interface CrossPassEdge {
  readonly fromPass: PassNumber;
  readonly toPass: PassNumber;
  readonly fromSliceId: string;
  readonly toSliceId: string;
  readonly kind: CrossPassEdgeKind;
  /** `llm` is only valid for `kind: 'llm-arbitrated'`. */
  readonly confidence: EdgeConfidence | 'llm';
  /** Human-readable evidence: the import line, shared fixture id, etc. */
  readonly evidence: string;
  /** The `LlmArbitration.callId` that produced this edge, or null. */
  readonly arbitratedBy: string | null;
}

/** Record of one LLM call made during decomposition. */
export interface LlmArbitration {
  readonly callId: string;
  /** sha256 hex of the prompt (used for content-hash cache lookup). */
  readonly promptHash: string;
  readonly input: string;
  readonly output: string;
  readonly confidence: LlmConfidence;
  readonly tokens: { readonly input: number; readonly output: number };
}

/** The slices + internal edges produced by one decomposition pass. */
export interface PassResult {
  readonly passNumber: PassNumber;
  readonly granularity: SliceGranularity;
  readonly slices: readonly SliceV2[];
  readonly internalEdges: readonly InternalEdge[];
}

/** Top-level v2 decomposition result. */
export interface DecompositionResultV2 {
  readonly schemaVersion: 'v2';
  readonly rid: string;
  /** ISO 8601 UTC, e.g. "2026-06-25T12:00:00.000Z". */
  readonly generatedAt: string;
  readonly passes: readonly PassResult[];
  readonly crossPassEdges: readonly CrossPassEdge[];
  readonly llmArbitrations: readonly LlmArbitration[];
  readonly codegraph: CodegraphEnvelope;
  readonly understandAnything: UnderstandAnythingEnvelope;
  /** True iff any pass failed to complete and the result is a partial. */
  readonly partial: boolean;
}
