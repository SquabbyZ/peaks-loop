// CONTRACT TEST — implementation pending; this test is the acceptance gate for slice 4.0.8 presence-lease-graph
// TC coverage: TC-AP-01..07. This is a scoped integration boundary, not Playwright E2E.
// Omitted render: protocol results are typed envelopes rather than rendered UI.

import { describe, expect, it } from 'vitest';

type AnyRecord = Record<string, unknown>;
type AckApi = AnyRecord & {
  prepareNode: (input: AnyRecord) => Promise<AnyRecord> | AnyRecord;
  dispatchNode: (input: AnyRecord) => Promise<AnyRecord> | AnyRecord;
  heartbeatNode: (input: AnyRecord) => Promise<AnyRecord> | AnyRecord;
  writeEnvelope: (input: AnyRecord) => Promise<AnyRecord> | AnyRecord;
  ackNode: (input: AnyRecord) => Promise<AnyRecord> | AnyRecord;
  markLost: (input: AnyRecord) => Promise<AnyRecord> | AnyRecord;
};

async function api(): Promise<AckApi> {
  const module = await import('../../src/services/workflow/workflow-node-lifecycle.js') as unknown as AnyRecord;
  const names = ['prepareNode', 'dispatchNode', 'heartbeatNode', 'writeEnvelope', 'ackNode', 'markLost'];
  for (const name of names) expect(typeof module[name]).toBe('function');
  return module as AckApi;
}

function codeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

async function expectCode(action: () => unknown, code: string): Promise<void> {
  try { await action(); throw new Error(`expected ${code}`); }
  catch (error: unknown) { expect(codeOf(error)).toBe(code); }
}

const base = (overrides: AnyRecord = {}): AnyRecord => ({
  projectRoot: 'integration-ack-project', sessionId: 'integration-ack-session', workflowId: 'workflow-ack', nodeId: 'dispatch-ack',
  kind: 'dispatch', label: 'dispatch', dependsOn: [], dispatchRef: 'dispatch/ack.json',
  ...overrides,
});

describe('workflow node ack protocol integration', () => {
  it('TC-AP-01: duplicate node ID is rejected before persistence. RD §8. Pass criterion: assert.equal(error.code, "PEAKS_NODE_EXISTS").', async () => { await expectCode(() => api().then((service) => service.prepareNode(base({ duplicate: true }))), 'PEAKS_NODE_EXISTS'); });
  it('TC-AP-02: missing dependency is rejected. RD §8. Pass criterion: assert.equal(error.code, "PEAKS_DEPENDENCY_NOT_CONSUMED").', async () => { await expectCode(() => api().then((service) => service.prepareNode(base({ dependsOn: ['missing'] }))), 'PEAKS_DEPENDENCY_NOT_CONSUMED'); });
  it('TC-AP-03: cycle is rejected. RD §8. Pass criterion: assert.equal(error.code, "PEAKS_GRAPH_CYCLE").', async () => { await expectCode(() => api().then((service) => service.prepareNode(base({ cycle: true }))), 'PEAKS_GRAPH_CYCLE'); });
  it('TC-AP-04: dispatch without graph-node is rejected. RD §8. Pass criterion: assert.equal(error.code, "PEAKS_GRAPH_NODE_REQUIRED").', async () => { await expectCode(() => api().then((service) => service.dispatchNode(base({ nodeId: undefined }))), 'PEAKS_GRAPH_NODE_REQUIRED'); });
  it('TC-AP-05: first heartbeat starts node and later heartbeat only updates timestamp. RD §8. Pass criterion: assert.equal(first.status, "running") and assert.equal(second.status, "running").', async () => { const service = await api(); const first = await service.heartbeatNode(base({ status: 'dispatched', firstHeartbeat: true })); const second = await service.heartbeatNode(base({ status: 'running', firstHeartbeat: false, lastHeartbeat: '2026-08-03T10:00:30.000Z' })); expect(first.status).toBe('running'); expect(second.status).toBe('running'); });
  it('TC-AP-06: mismatched envelope dispatch reference is rejected. RD §8. Pass criterion: assert.equal(error.code, "PEAKS_ENVELOPE_GRAPH_MISMATCH").', async () => { await expectCode(() => api().then((service) => service.writeEnvelope(base({ dispatchRef: 'a', envelopeDispatchRef: 'b' }))), 'PEAKS_ENVELOPE_GRAPH_MISMATCH'); });
  it('TC-AP-07: mark-lost cannot overwrite consumed or terminal graph. RD §8. Pass criterion: assert.equal(error.code, "PEAKS_NODE_TRANSITION_INVALID").', async () => { const service = await api(); await expectCode(() => service.markLost(base({ status: 'consumed-by-parent' })), 'PEAKS_NODE_TRANSITION_INVALID'); await expectCode(() => service.markLost(base({ status: 'terminalized' })), 'PEAKS_NODE_TRANSITION_INVALID'); });
});

void describe;
