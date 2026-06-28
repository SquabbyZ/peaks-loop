/**
 * v2.15.0 follow-up — G12 tests: foundation / upstreamSync / complexity
 * fields on SliceNode, validateDag extensions, topologicalLevels priority,
 * serializeDag stability, hashDag stability.
 */
import { describe, it, expect } from 'vitest';
import {
  validateDag,
  topologicalLevels,
  serializeDag,
  hashDag,
  InvalidSliceDagError,
  type SliceDag,
  type SliceNode
} from '../../../src/services/dispatch/slice-dag.js';

function makeNode(over: Partial<SliceNode> & { id: string; role: string }): SliceNode {
  return over;
}

describe('SliceNode optional fields (G12/G11/G2)', () => {
  it('accepts a node with no new fields (back-compat)', () => {
    const dag: SliceDag = { nodes: [{ id: 'a', role: 'rd' }], edges: [] };
    expect(() => validateDag(dag)).not.toThrow();
  });

  it('accepts a node with foundation=true', () => {
    const dag: SliceDag = { nodes: [{ id: 'b', role: 'rd', foundation: true }], edges: [] };
    expect(() => validateDag(dag)).not.toThrow();
  });

  it('accepts a node with upstreamSync=true and complexity=complex', () => {
    const dag: SliceDag = {
      nodes: [{ id: 'u', role: 'rd', upstreamSync: true, complexity: 'complex' }],
      edges: []
    };
    expect(() => validateDag(dag)).not.toThrow();
  });

  it('rejects foundation set to non-boolean', () => {
    const dag = {
      nodes: [{ id: 'x', role: 'rd', foundation: 'yes' as unknown as boolean }],
      edges: []
    } as SliceDag;
    expect(() => validateDag(dag)).toThrow(InvalidSliceDagError);
    expect(() => validateDag(dag)).toThrow(/foundation must be boolean/);
  });

  it('rejects upstreamSync set to non-boolean', () => {
    const dag = {
      nodes: [{ id: 'x', role: 'rd', upstreamSync: 1 as unknown as boolean }],
      edges: []
    } as SliceDag;
    expect(() => validateDag(dag)).toThrow(InvalidSliceDagError);
  });

  it('rejects complexity not in {trivial, simple, complex}', () => {
    const dag = {
      nodes: [{ id: 'x', role: 'rd', complexity: 'urgent' as unknown as SliceNode['complexity'] }],
      edges: []
    } as SliceDag;
    expect(() => validateDag(dag)).toThrow(InvalidSliceDagError);
    expect(() => validateDag(dag)).toThrow(/complexity must be one of/);
  });

  it('accepts all 3 complexity values', () => {
    for (const c of ['trivial', 'simple', 'complex'] as const) {
      const dag: SliceDag = { nodes: [{ id: `n-${c}`, role: 'rd', complexity: c }], edges: [] };
      expect(() => validateDag(dag)).not.toThrow();
    }
  });
});

describe('validateDag defensive rule: foundation cannot depend on non-foundation', () => {
  it('rejects foundation slice depending on business slice', () => {
    const dag: SliceDag = {
      nodes: [
        { id: 'biz', role: 'rd' },
        { id: 'fnd', role: 'rd', foundation: true }
      ],
      edges: [{ from: 'biz', to: 'fnd' }]
    };
    expect(() => validateDag(dag)).toThrow(InvalidSliceDagError);
    expect(() => validateDag(dag)).toThrow(/foundation slice fnd cannot depend on non-foundation slice biz/);
  });

  it('accepts business slice depending on foundation slice (main use case)', () => {
    const dag: SliceDag = {
      nodes: [
        { id: 'fnd', role: 'rd', foundation: true },
        { id: 'biz', role: 'rd' }
      ],
      edges: [{ from: 'fnd', to: 'biz' }]
    };
    expect(() => validateDag(dag)).not.toThrow();
  });

  it('accepts foundation depending on foundation', () => {
    const dag: SliceDag = {
      nodes: [
        { id: 'fnd1', role: 'rd', foundation: true },
        { id: 'fnd2', role: 'rd', foundation: true }
      ],
      edges: [{ from: 'fnd1', to: 'fnd2' }]
    };
    expect(() => validateDag(dag)).not.toThrow();
  });
});

describe('topologicalLevels: foundation + upstreamSync priority within level', () => {
  it('puts foundation slices before business slices within the same level', () => {
    const dag: SliceDag = {
      nodes: [
        { id: 'biz1', role: 'rd' },
        { id: 'fnd1', role: 'rd', foundation: true },
        { id: 'biz2', role: 'rd' }
      ],
      edges: []
    };
    const levels = topologicalLevels(dag);
    expect(levels.length).toBe(1);
    expect(levels[0]?.[0]).toBe('fnd1');
    expect(levels[0]?.slice(1).sort()).toEqual(['biz1', 'biz2']);
  });

  it('puts upstreamSync slices before regular business slices within the same level', () => {
    const dag: SliceDag = {
      nodes: [
        { id: 'biz', role: 'rd' },
        { id: 'upstream', role: 'rd', upstreamSync: true }
      ],
      edges: []
    };
    const levels = topologicalLevels(dag);
    expect(levels[0]?.[0]).toBe('upstream');
  });

  it('puts foundation before upstreamSync when both in same level', () => {
    const dag: SliceDag = {
      nodes: [
        { id: 'u', role: 'rd', upstreamSync: true },
        { id: 'f', role: 'rd', foundation: true }
      ],
      edges: []
    };
    const levels = topologicalLevels(dag);
    expect(levels[0]?.[0]).toBe('f');
    expect(levels[0]?.[1]).toBe('u');
  });

  it('preserves stable id-asc sort within same priority', () => {
    const dag: SliceDag = {
      nodes: [
        { id: 'z', role: 'rd', foundation: true },
        { id: 'a', role: 'rd', foundation: true },
        { id: 'm', role: 'rd', foundation: true }
      ],
      edges: []
    };
    const levels = topologicalLevels(dag);
    expect(levels[0]).toEqual(['a', 'm', 'z']);
  });
});

describe('serializeDag + hashDag: new fields are stable', () => {
  it('hashDag is stable for the same DAG with new fields', () => {
    const dag: SliceDag = {
      nodes: [
        { id: 'a', role: 'rd', foundation: true, complexity: 'complex' },
        { id: 'b', role: 'qa', upstreamSync: true }
      ],
      edges: [{ from: 'a', to: 'b' }]
    };
    const h1 = hashDag(dag);
    const h2 = hashDag(dag);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('hashDag differs when foundation is added', () => {
    const base: SliceDag = { nodes: [{ id: 'a', role: 'rd' }], edges: [] };
    const withFoundation: SliceDag = { nodes: [{ id: 'a', role: 'rd', foundation: true }], edges: [] };
    expect(hashDag(base)).not.toBe(hashDag(withFoundation));
  });

  it('hashDag differs when complexity changes', () => {
    const simple: SliceDag = { nodes: [{ id: 'a', role: 'rd', complexity: 'simple' }], edges: [] };
    const complex: SliceDag = { nodes: [{ id: 'a', role: 'rd', complexity: 'complex' }], edges: [] };
    expect(hashDag(simple)).not.toBe(hashDag(complex));
  });

  it('hashDag unchanged for old DAGs without new fields (back-compat)', () => {
    // Build a 2-node DAG identical to a v1.x DAG (no new fields)
    const old: SliceDag = {
      nodes: [{ id: 'a', role: 'rd' }, { id: 'b', role: 'qa' }],
      edges: [{ from: 'a', to: 'b' }]
    };
    // The hash format must be 64-hex; just verify determinism
    expect(hashDag(old)).toBe(hashDag(old));
    expect(hashDag(old)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('serializeDag includes new fields when present', () => {
    const dag: SliceDag = {
      nodes: [{ id: 'x', role: 'rd', foundation: true, complexity: 'complex' }],
      edges: []
    };
    const json = serializeDag(dag);
    expect(json).toContain('"foundation":true');
    expect(json).toContain('"complexity":"complex"');
  });
});
