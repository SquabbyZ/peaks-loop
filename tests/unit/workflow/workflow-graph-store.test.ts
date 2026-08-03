// CONTRACT TEST — implementation pending; this test is the acceptance gate for slice 4.0.8 presence-lease-graph
// TC coverage: TC-SM-09, TC-SM-11, TC-AG-02, TC-AG-03.
// Omitted render: graph store returns validated records rather than rendered output.

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/workflow/workflow-graph-store.test.ts',
  ['behavior', 'integration', 'a11y'],
  [{ dim: 'render', reason: 'graph store has no UI/rendered output' }],
);

type AnyRecord = Record<string, unknown>;
type GraphStoreApi = AnyRecord & {
  readGraph: (input: AnyRecord) => Promise<AnyRecord> | AnyRecord;
  writeGraph: (input: AnyRecord) => Promise<AnyRecord> | AnyRecord;
  validateGraph: (input: AnyRecord) => Promise<AnyRecord> | AnyRecord;
};

async function loadGraphStore(): Promise<GraphStoreApi> {
  const module = await import('~/src/services/workflow/workflow-graph-store.js') as unknown as AnyRecord;
  for (const name of ['readGraph', 'writeGraph', 'validateGraph']) expect(typeof module[name]).toBe('function');
  return module as GraphStoreApi;
}

function codeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

async function expectCode(action: () => unknown, code: string): Promise<void> {
  try {
    await action();
    throw new Error(`expected ${code}`);
  } catch (error: unknown) {
    expect(codeOf(error)).toBe(code);
  }
}

function graph(overrides: AnyRecord = {}): AnyRecord {
  return {
    workflowId: 'workflow-graph-test',
    rootSkill: 'peaks-code',
    nodes: [{ id: 'terminal', kind: 'terminal', label: 'complete', status: 'prepared', dependsOn: [] }],
    edges: [],
    schemaVersion: 1,
    ...overrides,
  };
}

const projects: string[] = [];
async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'peaks-graph-store-unit-'));
  projects.push(root);
  return root;
}

afterEach(async () => {
  for (const root of projects.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('behavior — graph invariants fail closed', () => {
  it('TC-SM-11: invalid JSON and cycles produce PEAKS_GRAPH_CORRUPTED with no active projection. RD §3. Pass criterion: assert.equal(error.code, "PEAKS_GRAPH_CORRUPTED").', async () => {
    const root = await project();
    const graphPath = join(root, 'graphs', 'workflow-graph-test.json');
    await mkdir(join(root, 'graphs'), { recursive: true });
    await writeFile(graphPath, '{broken-json', 'utf8');
    const api = await loadGraphStore();
    await expectCode(() => api.readGraph({ projectRoot: root, graphPath }), 'PEAKS_GRAPH_CORRUPTED');
    await expectCode(
      () => api.validateGraph(graph({ edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }], nodes: [
        { id: 'a', kind: 'step', label: 'a', status: 'prepared', dependsOn: ['b'] },
        { id: 'b', kind: 'terminal', label: 'b', status: 'prepared', dependsOn: ['a'] },
      ] })),
      'PEAKS_GRAPH_CORRUPTED',
    );
  });

  it('TC-SM-09: malformed canonical graph is surfaced even when a legacy marker is valid. RD §3. Pass criterion: assert.equal(error.code, "PEAKS_GRAPH_CORRUPTED") and assert.equal(error.legacyFallback, false).', async () => {
    const root = await project();
    const graphPath = join(root, 'graphs', 'workflow-graph-test.json');
    await mkdir(join(root, 'graphs'), { recursive: true });
    await writeFile(graphPath, '{not-json', 'utf8');
    await writeFile(join(root, 'active-skill.json'), JSON.stringify({ skill: 'peaks-code', active: true }), 'utf8');
    const api = await loadGraphStore();
    try {
      await api.readGraph({ projectRoot: root, graphPath, legacyMarkerPath: join(root, 'active-skill.json') });
      throw new Error('expected malformed canonical graph error');
    } catch (error: unknown) {
      expect(codeOf(error)).toBe('PEAKS_GRAPH_CORRUPTED');
      expect((error as { legacyFallback?: boolean }).legacyFallback).toBe(false);
    }
  });
});

describe('integration — production ESM graph parsing', () => {
  it('TC-AG-02: canonical corruption escapes instead of falling through to legacy. RD §7. Pass criterion: assert.equal(error.code, "PEAKS_GRAPH_CORRUPTED").', async () => {
    const root = await project();
    const graphPath = join(root, 'graphs', 'workflow-graph-test.json');
    await mkdir(join(root, 'graphs'), { recursive: true });
    await writeFile(graphPath, '{ malformed canonical', 'utf8');
    await writeFile(join(root, 'legacy-marker.json'), JSON.stringify({ skill: 'peaks-code' }), 'utf8');
    const api = await loadGraphStore();
    await expectCode(() => api.readGraph({ projectRoot: root, graphPath, legacyMarkerPath: join(root, 'legacy-marker.json') }), 'PEAKS_GRAPH_CORRUPTED');
  });

  it('TC-AG-03: syntactically invalid graph JSON escapes PEAKS_GRAPH_CORRUPTED. RD §7. Pass criterion: assert.equal(error.code, "PEAKS_GRAPH_CORRUPTED") and assert.equal(readsActive, false).', async () => {
    const root = await project();
    const graphPath = join(root, 'graphs', 'workflow-graph-test.json');
    await mkdir(join(root, 'graphs'), { recursive: true });
    await writeFile(graphPath, '[] trailing', 'utf8');
    const api = await loadGraphStore();
    await expectCode(() => api.readGraph({ projectRoot: root, graphPath }), 'PEAKS_GRAPH_CORRUPTED');
  });
});
