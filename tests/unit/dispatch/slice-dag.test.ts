/**
 * 2.7.0 slice-dag-dispatcher MVP (slice 1.2.a) — slice-dag model tests.
 *
 * Covers AC-1.a / AC-1.b / AC-1.c / AC-1.d from the 1.1 PRD.
 */
import { describe, expect, it } from 'vitest';
import {
  hashDag,
  InvalidSliceDagError,
  serializeDag,
  SliceDagCycleError,
  sliceReadyToRun,
  topologicalLevels,
  validateDag,
  type SliceDag
} from '../../../src/services/dispatch/slice-dag.js';

const linear: SliceDag = {
  nodes: [
    { id: 'A', role: 'rd' },
    { id: 'B', role: 'qa' },
    { id: 'C', role: 'qa' }
  ],
  edges: [
    { from: 'A', to: 'B' },
    { from: 'B', to: 'C' }
  ]
};

const diamond: SliceDag = {
  nodes: [
    { id: 'A', role: 'rd' },
    { id: 'B', role: 'qa' },
    { id: 'C', role: 'qa' },
    { id: 'D', role: 'rd' }
  ],
  edges: [
    { from: 'A', to: 'B' },
    { from: 'A', to: 'C' },
    { from: 'B', to: 'D' },
    { from: 'C', to: 'D' }
  ]
};

const parallel: SliceDag = {
  nodes: [
    { id: 'A', role: 'rd' },
    { id: 'B', role: 'qa' },
    { id: 'C', role: 'qa' }
  ],
  edges: [
    { from: 'A', to: 'B' },
    { from: 'A', to: 'C' }
  ]
};

describe('validateDag', () => {
  it('accepts linear / diamond / parallel DAGs', () => {
    expect(() => validateDag(linear)).not.toThrow();
    expect(() => validateDag(diamond)).not.toThrow();
    expect(() => validateDag(parallel)).not.toThrow();
  });

  it('rejects empty node list', () => {
    expect(() => validateDag({ nodes: [], edges: [] })).toThrow(InvalidSliceDagError);
  });

  it('rejects duplicate node ids', () => {
    expect(() =>
      validateDag({
        nodes: [
          { id: 'A', role: 'rd' },
          { id: 'A', role: 'qa' }
        ],
        edges: []
      })
    ).toThrow(/duplicate/i);
  });

  it('rejects edge that references unknown node', () => {
    expect(() =>
      validateDag({
        nodes: [{ id: 'A', role: 'rd' }],
        edges: [{ from: 'A', to: 'Z' }]
      })
    ).toThrow(/unknown node/);
  });

  it('rejects self-loop', () => {
    expect(() =>
      validateDag({
        nodes: [{ id: 'A', role: 'rd' }],
        edges: [{ from: 'A', to: 'A' }]
      })
    ).toThrow(/self-loop/);
  });
});

describe('topologicalLevels', () => {
  it('returns 3 levels for linear A->B->C', () => {
    const levels = topologicalLevels(linear);
    expect(levels.length).toBe(3);
    expect(levels[0]).toEqual(['A']);
    expect(levels[1]).toEqual(['B']);
    expect(levels[2]).toEqual(['C']);
  });

  it('returns 3 levels for diamond A->{B,C}->D', () => {
    const levels = topologicalLevels(diamond);
    expect(levels.length).toBe(3);
    expect(levels[0]).toEqual(['A']);
    expect(levels[1]).toEqual(['B', 'C']);
    expect(levels[2]).toEqual(['D']);
  });

  it('returns 2 levels for parallel A->{B,C}', () => {
    const levels = topologicalLevels(parallel);
    expect(levels.length).toBe(2);
    expect(levels[0]).toEqual(['A']);
    expect(levels[1]).toEqual(['B', 'C']);
  });

  it('detects cycles and throws SliceDagCycleError', () => {
    const cycle: SliceDag = {
      nodes: [
        { id: 'A', role: 'rd' },
        { id: 'B', role: 'qa' }
      ],
      edges: [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'A' }
      ]
    };
    expect(() => topologicalLevels(cycle)).toThrow(SliceDagCycleError);
  });
});

describe('sliceReadyToRun', () => {
  it('returns initial level when nothing is completed', () => {
    expect(sliceReadyToRun(diamond, new Set())).toEqual(['A']);
  });

  it('returns next level after A completes', () => {
    expect(sliceReadyToRun(diamond, new Set(['A']))).toEqual(['B', 'C']);
  });

  it('returns D only after both B and C complete', () => {
    expect(sliceReadyToRun(diamond, new Set(['A', 'B']))).toEqual(['C']);
    expect(sliceReadyToRun(diamond, new Set(['A', 'B', 'C']))).toEqual(['D']);
  });

  it('excludes already-completed nodes', () => {
    expect(sliceReadyToRun(diamond, new Set(['A', 'B', 'C', 'D']))).toEqual([]);
  });
});

describe('serializeDag / hashDag stability', () => {
  it('serializes linear DAG with sorted keys and arrays', () => {
    const json = serializeDag(linear);
    const parsed = JSON.parse(json) as { nodes: Array<{ id: string; role: string }>; edges: Array<{ from: string; to: string }> };
    expect(parsed.nodes.map((n) => n.id)).toEqual(['A', 'B', 'C']);
    expect(parsed.edges).toEqual([
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' }
    ]);
  });

  it('produces a stable SHA-256 hash regardless of input array ordering', () => {
    const reordered: SliceDag = {
      nodes: [
        { id: 'C', role: 'qa' },
        { id: 'A', role: 'rd' },
        { id: 'B', role: 'qa' }
      ],
      edges: [
        { from: 'B', to: 'C' },
        { from: 'A', to: 'B' }
      ]
    };
    expect(hashDag(linear)).toBe(hashDag(reordered));
  });

  it('produces different hashes for different DAGs', () => {
    expect(hashDag(linear)).not.toBe(hashDag(diamond));
    expect(hashDag(parallel)).not.toBe(hashDag(diamond));
  });
});
