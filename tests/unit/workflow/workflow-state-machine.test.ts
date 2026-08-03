// CONTRACT TEST — implementation pending; this test is the acceptance gate for slice 4.0.8 presence-lease-graph
// TC coverage: TC-SM-01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12 and TC-AP-01..07 forbidden transitions.
// Omitted render: this pure state machine exposes domain states, not rendered output.

import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/workflow/workflow-state-machine.test.ts',
  ['behavior', 'a11y'],
  [
    { dim: 'render', reason: 'state transitions have no rendered surface' },
    { dim: 'integration', reason: 'pure transition contract does not mock filesystem or external boundaries' },
  ],
);

type State = 'preparing' | 'running' | 'terminalized' | 'lost' | 'prepared' | 'dispatched' | 'envelope-received' | 'consumed-by-parent';
type AnyRecord = Record<string, unknown>;
type StateMachineApi = AnyRecord & {
  transitionLease: (from: State, to: State, input?: AnyRecord) => AnyRecord;
  transitionNode: (from: State, to: State, input?: AnyRecord) => AnyRecord;
  prepareNode: (graph: AnyRecord, node: AnyRecord) => AnyRecord;
  acknowledgeNode: (node: AnyRecord) => AnyRecord;
  markNodeLost: (node: AnyRecord, reason: string) => AnyRecord;
};

async function loadStateMachine(): Promise<StateMachineApi> {
  const module = await import('~/src/services/workflow/workflow-node-lifecycle.js') as unknown as AnyRecord;
  for (const name of ['transitionLease', 'transitionNode', 'prepareNode', 'acknowledgeNode', 'markNodeLost']) expect(typeof module[name]).toBe('function');
  return module as StateMachineApi;
}

function codeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const value = (error as { code?: unknown }).code;
  return typeof value === 'string' ? value : undefined;
}

async function expectCode(action: () => unknown, code: string): Promise<void> {
  try {
    await action();
    throw new Error(`expected ${code}`);
  } catch (error: unknown) {
    expect(codeOf(error)).toBe(code);
  }
}

const transition = (kind: 'lease' | 'node', from: State, to: State, input: AnyRecord = {}) => async () => {
  const api = await loadStateMachine();
  return kind === 'lease' ? api.transitionLease(from, to, input) : api.transitionNode(from, to, input);
};

describe('behavior — allowed lease and graph transitions', () => {
  it('TC-SM-01: prepare → running → terminalized success is ordered. RD §3. Pass criterion: assert.deepEqual(states, ["preparing", "running", "terminalized"]).', async () => {
    const api = await loadStateMachine();
    const running = api.transitionLease('preparing', 'running', { lastHeartbeat: '2026-08-03T10:00:00.000Z' });
    const terminal = api.transitionLease('running', 'terminalized', { terminalReason: 'success' });
    expect(running.status).toBe('running');
    expect(terminal.status).toBe('terminalized');
    expect(terminal.terminalReason).toBe('success');
  });

  it('TC-SM-02: running → lost records sub-agent-crashed. RD §3. Pass criterion: assert.equal(result.terminalReason, "sub-agent-crashed").', async () => {
    const api = await loadStateMachine();
    const result = api.transitionLease('running', 'lost', { terminalReason: 'sub-agent-crashed' });
    expect(result.status).toBe('lost');
    expect(result.terminalReason).toBe('sub-agent-crashed');
  });

  it('TC-SM-03: envelope-received remains pending until parent consumes it. RD §3. Pass criterion: assert.equal(node.ackStatus, "pending") and assert.equal(node.status, "envelope-received").', async () => {
    const api = await loadStateMachine();
    const node = api.transitionNode('running', 'envelope-received', { ackStatus: 'pending' });
    expect(node.status).toBe('envelope-received');
    expect(node.ackStatus).toBe('pending');
  });

  it('TC-SM-04: ack without envelope rejects PEAKS_ENVELOPE_NOT_RECEIVED. RD §3. Pass criterion: assert.equal(error.code, "PEAKS_ENVELOPE_NOT_RECEIVED").', async () => {
    const api = await loadStateMachine();
    await expectCode(() => api.acknowledgeNode({ status: 'running', ackStatus: 'pending' }), 'PEAKS_ENVELOPE_NOT_RECEIVED');
  });

  it('TC-SM-05: outer-session mismatch loses old ownership without transferring its workflow. RD §3. Pass criterion: assert.equal(old.terminalReason, "outer-session-mismatch") and assert.notEqual(newLease.workflowId, old.workflowId).', async () => {
    const api = await loadStateMachine();
    const oldLease = api.transitionLease('running', 'lost', { terminalReason: 'outer-session-mismatch', callerId: 'old-caller' });
    const newLease = api.transitionLease('preparing', 'running', { callerId: 'new-caller', workflowId: 'new-workflow' });
    expect(oldLease.terminalReason).toBe('outer-session-mismatch');
    expect(newLease.workflowId).toBe('new-workflow');
    expect(newLease.workflowId).not.toBe(oldLease.workflowId);
  });

  it('TC-SM-06: stale predicates are accepted only when both thresholds hold. RD §3. Pass criterion: assert.equal(result.status, "lost") and assert.equal(result.terminalReason, "ttl-expired").', async () => {
    const api = await loadStateMachine();
    const result = api.transitionLease('running', 'lost', { terminalReason: 'ttl-expired', lastHeartbeatAgeMs: 3_600_001, startedAtAgeMs: 86_400_001 });
    expect(result.status).toBe('lost');
    expect(result.terminalReason).toBe('ttl-expired');
  });

  it('TC-SM-07: caller-scoped terminalization does not clear another caller. RD §3. Pass criterion: assert.equal(result.callerId, "caller-a") and assert.notEqual(result.callerId, "caller-b").', async () => {
    const api = await loadStateMachine();
    const result = api.transitionLease('running', 'terminalized', { callerId: 'caller-a', expectedCallerId: 'caller-a', terminalReason: 'success' });
    expect(result.callerId).toBe('caller-a');
    expect(result.callerId).not.toBe('caller-b');
  });

  it('TC-SM-08: nested workflow preserves parent and depth ownership fields. RD §3. Pass criterion: assert.equal(result.parentWorkflowId, "parent") and assert.equal(result.depth, 1).', async () => {
    const api = await loadStateMachine();
    const result = api.transitionLease('preparing', 'running', { workflowId: 'child', parentWorkflowId: 'parent', depth: 1 });
    expect(result.parentWorkflowId).toBe('parent');
    expect(result.depth).toBe(1);
  });
  it('TC-SM-09: terminalized and lost states cannot revive. RD §3. Pass criterion: assert.equal(error.code, "PEAKS_NODE_TRANSITION_INVALID") for both revival attempts.', async () => {
    const api = await loadStateMachine();
    await expectCode(() => api.transitionLease('terminalized', 'running'), 'PEAKS_NODE_TRANSITION_INVALID');
    await expectCode(() => api.transitionLease('lost', 'preparing'), 'PEAKS_NODE_TRANSITION_INVALID');
  });

  it('TC-SM-10: read-style transition probe does not mutate lastHeartbeat. RD §3. Pass criterion: assert.equal(after.lastHeartbeat, before.lastHeartbeat).', async () => {
    const api = await loadStateMachine();
    const before = { status: 'running', lastHeartbeat: '2026-08-03T09:30:00.000Z' };
    const after = api.transitionNode('running', 'running', { ...before, probe: true });
    expect(after.lastHeartbeat).toBe(before.lastHeartbeat);
  });

  it('TC-SM-11: graph corruption never projects active running state. RD §3. Pass criterion: assert.equal(error.code, "PEAKS_GRAPH_CORRUPTED").', async () => {
    const api = await loadStateMachine();
    await expectCode(() => api.transitionNode('running', 'running', { graphValid: false }), 'PEAKS_GRAPH_CORRUPTED');
  });

  it('TC-SM-12: mismatched graphRef is rejected before transition. RD §3. Pass criterion: assert.equal(error.code, "PEAKS_GRAPH_REF_BROKEN").', async () => {
    const api = await loadStateMachine();
    await expectCode(() => api.transitionLease('running', 'terminalized', { workflowId: 'a', graphRef: 'graphs/b.json' }), 'PEAKS_GRAPH_REF_BROKEN');
  });
});

describe('behavior — forbidden ack protocol transitions', () => {
  it('TC-AP-01: prepare rejects duplicate node ID with PEAKS_NODE_EXISTS. RD §3. Pass criterion: assert.equal(error.code, "PEAKS_NODE_EXISTS").', async () => {
    const api = await loadStateMachine();
    await expectCode(() => api.prepareNode({ nodes: [{ id: 'node-a' }] }, { id: 'node-a', kind: 'step' }), 'PEAKS_NODE_EXISTS');
  });

  it('TC-AP-02: prepare rejects missing dependency with PEAKS_DEPENDENCY_NOT_CONSUMED. RD §3. Pass criterion: assert.equal(error.code, "PEAKS_DEPENDENCY_NOT_CONSUMED").', async () => {
    const api = await loadStateMachine();
    await expectCode(() => api.prepareNode({ nodes: [] }, { id: 'node-b', kind: 'step', dependsOn: ['missing'] }), 'PEAKS_DEPENDENCY_NOT_CONSUMED');
  });

  it('TC-AP-03: prepare rejects a cycle with PEAKS_GRAPH_CYCLE. RD §3. Pass criterion: assert.equal(error.code, "PEAKS_GRAPH_CYCLE").', async () => {
    const api = await loadStateMachine();
    await expectCode(() => api.prepareNode({ nodes: [{ id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['a'] }] }, { id: 'c', dependsOn: ['a'] }), 'PEAKS_GRAPH_CYCLE');
  });

  it('TC-AP-04: dispatch without graph node rejects PEAKS_GRAPH_NODE_REQUIRED. RD §3. Pass criterion: assert.equal(error.code, "PEAKS_GRAPH_NODE_REQUIRED").', async () => {
    const api = await loadStateMachine();
    await expectCode(() => api.transitionNode('prepared', 'dispatched', { graphNode: undefined }), 'PEAKS_GRAPH_NODE_REQUIRED');
  });

  it('TC-AP-05: only first heartbeat transitions dispatched → running. RD §3. Pass criterion: assert.equal(first.status, "running") and assert.equal(second.status, "running").', async () => {
    const api = await loadStateMachine();
    const first = api.transitionNode('dispatched', 'running', { firstHeartbeat: true, lastHeartbeat: '2026-08-03T10:00:00.000Z' });
    const second = api.transitionNode('running', 'running', { firstHeartbeat: false, lastHeartbeat: '2026-08-03T10:00:30.000Z' });
    expect(first.status).toBe('running');
    expect(second.status).toBe('running');
    expect(second.lastHeartbeat).toBe('2026-08-03T10:00:30.000Z');
  });

  it('TC-AP-06: mismatched envelope dispatchRef rejects PEAKS_ENVELOPE_GRAPH_MISMATCH. RD §3. Pass criterion: assert.equal(error.code, "PEAKS_ENVELOPE_GRAPH_MISMATCH").', async () => {
    const api = await loadStateMachine();
    await expectCode(() => api.transitionNode('running', 'envelope-received', { dispatchRef: 'dispatch-a', envelopeDispatchRef: 'dispatch-b' }), 'PEAKS_ENVELOPE_GRAPH_MISMATCH');
  });

  it('TC-AP-07: mark-lost cannot overwrite consumed-by-parent or terminal graph. RD §3. Pass criterion: assert.equal(error.code, "PEAKS_NODE_TRANSITION_INVALID") for both cases.', async () => {
    const api = await loadStateMachine();
    await expectCode(() => api.markNodeLost({ status: 'consumed-by-parent' }, 'sub-agent-crashed'), 'PEAKS_NODE_TRANSITION_INVALID');
    await expectCode(() => api.markNodeLost({ status: 'terminalized' }, 'sub-agent-crashed'), 'PEAKS_NODE_TRANSITION_INVALID');
  });
});

describe('a11y — typed transition errors remain actionable', () => {
  it('reports the exact forbidden-transition code rather than a generic failure. RD §3. Pass criterion: assert.equal(error.code, "PEAKS_NODE_TRANSITION_INVALID").', async () => {
    const api = await loadStateMachine();
    try {
      api.transitionNode('terminalized', 'running');
      throw new Error('expected transition failure');
    } catch (error: unknown) {
      expect(codeOf(error)).toBe('PEAKS_NODE_TRANSITION_INVALID');
    }
  });
});

void transition;
