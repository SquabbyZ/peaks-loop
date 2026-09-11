import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { provisionDispatchNode } from '../../../../src/services/workflow/provision-dispatch-node.js';
import { readGraph } from '../../../../src/services/workflow/workflow-graph-store.js';

/**
 * `--graph-node` used to be a `.requiredOption` whose failure message told
 * the caller to run `peaks workflow node prepare` first. That instruction
 * could not be followed: `node prepare` never persists (it prints a single
 * node into a field named `graph` and drops it), and the graph it reads has
 * no creator. So the three-step ritual had no viable first step, and every
 * project without graph infrastructure could not dispatch at all.
 *
 * These cases pin the replacement: one call, graph and node created on
 * demand, and the result valid enough that `readGraph` accepts it back.
 */
function freshProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-provision-'));
}

describe('provisionDispatchNode', () => {
  it('creates the graph when none exists, with the terminal node validateGraph requires', () => {
    const projectRoot = freshProject();
    const result = provisionDispatchNode({ projectRoot, sessionId: 'sid-1', role: 'rd' });

    expect(result.graphCreated).toBe(true);
    const graph = readGraph({
      projectRoot,
      sessionId: 'sid-1',
      graphRef: result.graphRef,
      workflowId: result.workflowId
    });
    // validateGraph rejects anything without exactly one terminal node, so a
    // successful round-trip is the real assertion here.
    expect(graph.nodes.filter((n) => n.kind === 'terminal')).toHaveLength(1);
    expect(graph.nodes.find((n) => n.id === result.nodeId)?.kind).toBe('dispatch');
  });

  it('appends to an existing graph rather than replacing it', () => {
    const projectRoot = freshProject();
    const first = provisionDispatchNode({ projectRoot, sessionId: 'sid-1', role: 'rd' });
    const second = provisionDispatchNode({ projectRoot, sessionId: 'sid-1', role: 'qa' });

    expect(second.graphCreated).toBe(false);
    expect(second.workflowId).toBe(first.workflowId);
    const graph = readGraph({
      projectRoot,
      sessionId: 'sid-1',
      graphRef: second.graphRef,
      workflowId: second.workflowId
    });
    const ids = graph.nodes.map((n) => n.id);
    expect(ids).toContain(first.nodeId);
    expect(ids).toContain(second.nodeId);
  });

  it('derives a workflowId from the session when none is supplied', () => {
    const result = provisionDispatchNode({ projectRoot: freshProject(), sessionId: '2026-09-11-session-abc', role: 'rd' });
    expect(result.workflowId).toBe('dispatch-2026-09-11-session-abc');
    expect(result.graphRef).toBe('graphs/dispatch-2026-09-11-session-abc.json');
  });

  it('honours a well-formed workflowId and refuses to build a path from a malformed one', () => {
    const ok = provisionDispatchNode({ projectRoot: freshProject(), sessionId: 'sid-1', role: 'rd', workflowId: 'my-flow' });
    expect(ok.workflowId).toBe('my-flow');

    // A malformed id must not reach the filesystem as a path segment; the
    // call falls back to the derived id instead of throwing, because the
    // whole point is that dispatch must not be blocked.
    const bad = provisionDispatchNode({ projectRoot: freshProject(), sessionId: 'sid-1', role: 'rd', workflowId: '../escape' });
    expect(bad.workflowId).toBe('dispatch-sid-1');
  });

  it('gives two dispatches of the same role distinct node ids', () => {
    const projectRoot = freshProject();
    let t = 1000;
    const now = () => (t += 1);
    const a = provisionDispatchNode({ projectRoot, sessionId: 'sid-1', role: 'rd', now });
    const b = provisionDispatchNode({ projectRoot, sessionId: 'sid-1', role: 'rd', now });
    expect(a.nodeId).not.toBe(b.nodeId);
  });
});
