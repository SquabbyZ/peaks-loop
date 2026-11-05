// CONTRACT TEST — implementation pending; this test is the acceptance gate for slice 4.0.8 presence-lease-graph
// TC coverage: TC-SM-09, TC-SM-11, TC-AG-02, TC-AG-03.
// Omitted render: graph store returns validated records rather than rendered output.

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { getSessionDir } from '~/src/services/session/getSessionDir.js';
import { graphPathFor } from '~/src/services/workflow/workflow-graph-store.js';
import { isInsidePath, normalizePath } from '~/src/shared/path-utils.js';

declareDimensions(
  'tests/unit/workflow/workflow-graph-store.test.ts',
  ['behavior', 'integration', 'a11y'],
  [{ dim: 'render', reason: 'graph store has no UI/rendered output' }]
);

type AnyRecord = Record<string, unknown>;
type GraphStoreApi = AnyRecord & {
  readGraph: (input: AnyRecord) => Promise<AnyRecord> | AnyRecord;
  writeGraph: (input: AnyRecord) => Promise<AnyRecord> | AnyRecord;
  validateGraph: (input: AnyRecord) => Promise<AnyRecord> | AnyRecord;
};

async function loadGraphStore(): Promise<GraphStoreApi> {
  const module =
    (await import('~/src/services/workflow/workflow-graph-store.js')) as unknown as AnyRecord;
  for (const name of ['readGraph', 'writeGraph', 'validateGraph'])
    expect(typeof module[name]).toBe('function');
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
    nodes: [
      { id: 'terminal', kind: 'terminal', label: 'complete', status: 'prepared', dependsOn: [] }
    ],
    edges: [],
    schemaVersion: 1,
    ...overrides
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

describe('Scenario: behavior — graph invariants fail closed', () => {
  it('when invoked, should TC-SM-11: invalid JSON and cycles produce PEAKS_GRAPH_CORRUPTED with no active projection. RD §3. Pass criterion: assert.equal(error.code, "PEAKS_GRAPH_CORRUPTED").', async () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const root = await project();
    const graphPath = join(root, 'graphs', 'workflow-graph-test.json');
    await mkdir(join(root, 'graphs'), { recursive: true });
    await writeFile(graphPath, '{broken-json', 'utf8');
    const api = await loadGraphStore();
    await expectCode(
      () => api.readGraph({ projectRoot: root, graphPath }),
      'PEAKS_GRAPH_CORRUPTED'
    );
    await expectCode(
      () =>
        api.validateGraph(
          graph({
            edges: [
              { from: 'a', to: 'b' },
              { from: 'b', to: 'a' }
            ],
            nodes: [
              { id: 'a', kind: 'step', label: 'a', status: 'prepared', dependsOn: ['b'] },
              { id: 'b', kind: 'terminal', label: 'b', status: 'prepared', dependsOn: ['a'] }
            ]
          })
        ),
      'PEAKS_GRAPH_CORRUPTED'
    );
  });

  it('when invoked, should TC-SM-09: malformed canonical graph is surfaced even when a legacy marker is valid. RD §3. Pass criterion: assert.equal(error.code, "PEAKS_GRAPH_CORRUPTED") and assert.equal(error.legacyFallback, false).', async () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const root = await project();
    const graphPath = join(root, 'graphs', 'workflow-graph-test.json');
    await mkdir(join(root, 'graphs'), { recursive: true });
    await writeFile(graphPath, '{not-json', 'utf8');
    await writeFile(
      join(root, 'active-skill.json'),
      JSON.stringify({ skill: 'peaks-code', active: true }),
      'utf8'
    );
    const api = await loadGraphStore();
    try {
      await api.readGraph({
        projectRoot: root,
        graphPath,
        legacyMarkerPath: join(root, 'active-skill.json')
      });
      throw new Error('expected malformed canonical graph error');
    } catch (error: unknown) {
      expect(codeOf(error)).toBe('PEAKS_GRAPH_CORRUPTED');
      expect((error as { legacyFallback?: boolean }).legacyFallback).toBe(false);
    }
  });
});

describe('Scenario: behavior — graphPathFor contains the ref inside the session root', () => {
  it('when the session root is emitted with forward slashes, should resolve a ref inside it', () => {
    // given: a session id and a graph ref the package itself builds
    // when: the on-disk path is computed
    // then: it resolves rather than throwing `graphRef escapes session root`.
    //   The session root comes from the workspace-runtime package with FORWARD
    //   slashes, while this resolve lands on the platform separator — on Windows
    //   the two spellings differ by separator alone, which is exactly the shape
    //   the old `startsWith(sessionRoot + sep)` test read as an escape.
    const projectRoot = join(tmpdir(), 'peaks-graph-sep');
    const sessionId = '2026-11-05-session-af31e4';
    const workflowId = 'wf-sep-1';
    const path = graphPathFor({
      projectRoot,
      sessionId,
      graphRef: `graphs/${workflowId}.json`,
      workflowId
    });
    const sessionRoot = getSessionDir(projectRoot, sessionId);
    expect(normalizePath(sessionRoot)).toMatch(/\/\.peaks\/_runtime\//);
    expect(normalizePath(path)).toBe(normalizePath(`${sessionRoot}/graphs/${workflowId}.json`));
    expect(isInsidePath(path, sessionRoot)).toBe(true);
  });

  it('when the ref is a traversal, should still refuse it', () => {
    // given: a graph ref that climbs out of the session root
    // when: the on-disk path is computed
    // then: the call refuses it as unsafe
    expect(() =>
      graphPathFor({
        projectRoot: join(tmpdir(), 'peaks-graph-sep'),
        sessionId: '2026-11-05-session-af31e4',
        graphRef: 'graphs/../../escape.json',
        workflowId: 'wf-sep-1'
      })
    ).toThrow(/graphRef is not safe/);
  });
});

describe('Scenario: integration — production ESM graph parsing', () => {
  it('when invoked, should TC-AG-02: canonical corruption escapes instead of falling through to legacy. RD §7. Pass criterion: assert.equal(error.code, "PEAKS_GRAPH_CORRUPTED").', async () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const root = await project();
    const graphPath = join(root, 'graphs', 'workflow-graph-test.json');
    await mkdir(join(root, 'graphs'), { recursive: true });
    await writeFile(graphPath, '{ malformed canonical', 'utf8');
    await writeFile(
      join(root, 'legacy-marker.json'),
      JSON.stringify({ skill: 'peaks-code' }),
      'utf8'
    );
    const api = await loadGraphStore();
    await expectCode(
      () =>
        api.readGraph({
          projectRoot: root,
          graphPath,
          legacyMarkerPath: join(root, 'legacy-marker.json')
        }),
      'PEAKS_GRAPH_CORRUPTED'
    );
  });

  it('when invoked, should TC-AG-03: syntactically invalid graph JSON escapes PEAKS_GRAPH_CORRUPTED. RD §7. Pass criterion: assert.equal(error.code, "PEAKS_GRAPH_CORRUPTED") and assert.equal(readsActive, false).', async () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const root = await project();
    const graphPath = join(root, 'graphs', 'workflow-graph-test.json');
    await mkdir(join(root, 'graphs'), { recursive: true });
    await writeFile(graphPath, '[] trailing', 'utf8');
    const api = await loadGraphStore();
    await expectCode(
      () => api.readGraph({ projectRoot: root, graphPath }),
      'PEAKS_GRAPH_CORRUPTED'
    );
  });
});
