/**
 * Type-level tests for slice-topology-types.ts (v2 schema).
 *
 * RED phase: file under test does not exist yet. Import will fail.
 * GREEN phase: types compile and runtime assertions hold.
 *
 * These tests do not exhaustively validate JSON-Schema files; they only
 * confirm the TypeScript surface that downstream services and tests rely on.
 */

import { describe, it, expect } from 'vitest';
import type {
  SchemaVersion,
  SliceGranularity,
  PassNumber,
  EdgeConfidence,
  LlmConfidence,
  InternalEdgeKind,
  CrossPassEdgeKind,
  PassConfig,
  SliceV2,
  InternalEdge,
  CrossPassEdge,
  LlmArbitration,
  PassResult,
  DecompositionResultV2
} from '../../../src/services/slice/slice-topology-types.js';
import type { CodegraphEnvelope, UnderstandAnythingEnvelope } from '../../../src/services/slice/slice-decompose-types.js';

describe('slice-topology-types', () => {
  it('exports SchemaVersion literal union accepting v1 and v2', () => {
    const v1: SchemaVersion = 'v1';
    const v2: SchemaVersion = 'v2';
    expect(v1).toBe('v1');
    expect(v2).toBe('v2');
  });

  it('exports SliceGranularity literal union', () => {
    const service: SliceGranularity = 'service';
    const file: SliceGranularity = 'file';
    const sub: SliceGranularity = 'sub-file';
    expect([service, file, sub]).toEqual(['service', 'file', 'sub-file']);
  });

  it('exports PassNumber literal union (1, 2, 3)', () => {
    const p1: PassNumber = 1;
    const p2: PassNumber = 2;
    const p3: PassNumber = 3;
    expect(p1 + p2 + p3).toBe(6);
  });

  it('exports EdgeConfidence literal union', () => {
    const s: EdgeConfidence = 'structural';
    const m: EdgeConfidence = 'semantic';
    expect(s).toBe('structural');
    expect(m).toBe('semantic');
  });

  it('exports LlmConfidence literal union', () => {
    const hi: LlmConfidence = 'high';
    const md: LlmConfidence = 'medium';
    const lo: LlmConfidence = 'low';
    expect([hi, md, lo]).toEqual(['high', 'medium', 'low']);
  });

  it('exports InternalEdgeKind literal union', () => {
    const kinds: readonly InternalEdgeKind[] = ['imports', 'calls', 'depends_on', 'contains_flow', 'flow_step'];
    expect(kinds.length).toBe(5);
  });

  it('exports CrossPassEdgeKind literal union', () => {
    const kinds: readonly CrossPassEdgeKind[] = ['type-shares', 'fixture-shares', 'import-re-export', 'llm-arbitrated'];
    expect(kinds.length).toBe(4);
  });

  it('PassConfig requires passNumber + granularity', () => {
    const c: PassConfig = { passNumber: 1, granularity: 'service' };
    expect(c.passNumber).toBe(1);
    expect(c.granularity).toBe('service');
  });

  it('SliceV2 has all required fields including null parentSliceId', () => {
    const s: SliceV2 = {
      id: 'S1',
      label: 'config',
      granularity: 'service',
      files: ['src/services/config/config-service.ts'],
      loc: 350,
      parentSliceId: null,
      semanticAnchor: 'file:src/services/config/config-service.ts'
    };
    expect(s.id).toBe('S1');
    expect(s.parentSliceId).toBeNull();
    expect(s.files.length).toBe(1);
  });

  it('InternalEdge includes kind, weight, evidence, confidence', () => {
    const e: InternalEdge = {
      from: 'S1',
      to: 'S2',
      kind: 'imports',
      weight: 10,
      evidence: "import { x } from './x'",
      confidence: 'structural'
    };
    expect(e.weight).toBe(10);
    expect(e.kind).toBe('imports');
  });

  it('CrossPassEdge includes llm confidence variant', () => {
    const e: CrossPassEdge = {
      fromPass: 1,
      toPass: 2,
      fromSliceId: 'S1',
      toSliceId: 'S1.1',
      kind: 'llm-arbitrated',
      confidence: 'llm',
      evidence: 'arbitrated by callId abc123',
      arbitratedBy: 'callId:abc123'
    };
    expect(e.confidence).toBe('llm');
    expect(e.arbitratedBy).toBe('callId:abc123');
  });

  it('LlmArbitration has promptHash + tokens { input, output }', () => {
    const a: LlmArbitration = {
      callId: 'live:abc',
      promptHash: 'sha256-hex',
      input: 'prompt text',
      output: 'response text',
      confidence: 'high',
      tokens: { input: 100, output: 200 }
    };
    expect(a.tokens.input).toBe(100);
    expect(a.tokens.output).toBe(200);
  });

  it('PassResult groups slices + internalEdges under one passNumber', () => {
    const slice: SliceV2 = {
      id: 'S1', label: 'lbl', granularity: 'service',
      files: ['a.ts'], loc: 50, parentSliceId: null, semanticAnchor: 'file:a.ts'
    };
    const edge: InternalEdge = {
      from: 'S1', to: 'S2', kind: 'calls', weight: 8,
      evidence: 'fn()', confidence: 'structural'
    };
    const pr: PassResult = {
      passNumber: 1,
      granularity: 'service',
      slices: [slice],
      internalEdges: [edge]
    };
    expect(pr.slices.length).toBe(1);
    expect(pr.internalEdges.length).toBe(1);
  });

  it('DecompositionResultV2 has schemaVersion v2 + composes CodegraphEnvelope + UnderstandAnythingEnvelope', () => {
    const codegraph: CodegraphEnvelope = {
      nodes: 0, edges: 0, dbMB: 0, freshness: 'indexed', affectedCrossFile: false, note: ''
    };
    const ua: UnderstandAnythingEnvelope = {
      kgNodes: 0, kgEdges: 0, available: false, fallback: 'structural-only', note: ''
    };
    const r: DecompositionResultV2 = {
      schemaVersion: 'v2',
      rid: 'test-rid',
      generatedAt: '2026-06-25T10:00:00.000Z',
      passes: [],
      crossPassEdges: [],
      llmArbitrations: [],
      codegraph,
      understandAnything: ua,
      partial: false
    };
    expect(r.schemaVersion).toBe('v2');
    expect(r.codegraph.freshness).toBe('indexed');
    expect(r.understandAnything.fallback).toBe('structural-only');
    expect(r.partial).toBe(false);
  });
});
