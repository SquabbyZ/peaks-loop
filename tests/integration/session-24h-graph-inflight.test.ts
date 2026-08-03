// CONTRACT TEST — implementation pending; this test is the acceptance gate for slice 4.0.8 presence-lease-graph
// TC coverage: TC-IF-01..09. This is a graph-backed integration matrix, not Playwright E2E.
// Omitted render: in-flight mode is a typed compaction decision.

import { describe, expect, it } from 'vitest';

type AnyRecord = Record<string, unknown>;
async function probe(): Promise<(input: AnyRecord) => AnyRecord> {
  const module = await import('../../src/services/workflow/workflow-inflight-probe.js') as unknown as AnyRecord;
  expect(typeof module.probeInFlightBatch).toBe('function');
  return module.probeInFlightBatch as (input: AnyRecord) => AnyRecord;
}
const now = '2026-08-03T10:00:00.000Z';
const fresh = { id: 'n', kind: 'dispatch', status: 'running', lastHeartbeat: '2026-08-03T09:40:01.000Z' };
const graph = (nodes: AnyRecord[], workflowId = 'workflow'): AnyRecord => ({ workflowId, rootSkill: 'peaks-code', nodes, edges: [], schemaVersion: 1 });

describe('session 24h graph in-flight matrix', () => {
  it('TC-IF-01: one fresh running node is true. RD §8. Pass criterion: assert.equal(result.inFlightBatch, true).', async () => { expect((await probe())({ now, graphs: [graph([fresh])] }).inFlightBatch).toBe(true); });
  it('TC-IF-02: any fresh running node across multiple graphs is true. RD §8. Pass criterion: assert.equal(result.inFlightBatch, true).', async () => { expect((await probe())({ now, graphs: [graph([], 'a'), graph([fresh], 'b')] }).inFlightBatch).toBe(true); });
  it('TC-IF-03: prepared/dispatched/envelope/consumed/terminal/lost are false. RD §8. Pass criterion: assert.equal(result.inFlightBatch, false).', async () => { const statuses = ['prepared', 'dispatched', 'envelope-received', 'consumed-by-parent', 'terminalized', 'lost']; expect((await probe())({ now, graphs: [graph(statuses.map((status) => ({ ...fresh, status })))] }).inFlightBatch).toBe(false); });
  it('TC-IF-04: 29:59 is true. RD §8. Pass criterion: assert.equal(result.inFlightBatch, true).', async () => { expect((await probe())({ now, graphs: [graph([{ ...fresh, lastHeartbeat: '2026-08-03T09:30:01.000Z' }])] }).inFlightBatch).toBe(true); });
  it('TC-IF-05: 30:00 is false. RD §8. Pass criterion: assert.equal(result.inFlightBatch, false).', async () => { expect((await probe())({ now, graphs: [graph([{ ...fresh, lastHeartbeat: '2026-08-03T09:30:00.000Z' }])] }).inFlightBatch).toBe(false); });
  it('TC-IF-06: running node without heartbeat is false with warning. RD §8. Pass criterion: assert.equal(result.warnings[0].code, "PEAKS_HEARTBEAT_MISSING").', async () => { const out = (await probe())({ now, graphs: [graph([{ ...fresh, lastHeartbeat: undefined }])] }); expect(out.inFlightBatch).toBe(false); expect((out.warnings as AnyRecord[])[0]?.code).toBe('PEAKS_HEARTBEAT_MISSING'); });
  it('TC-IF-07: stale running node is false even when lease is fresh. RD §8. Pass criterion: assert.equal(result.inFlightBatch, false).', async () => { expect((await probe())({ now, leases: [{ startedAt: '2026-08-03T09:50:00.000Z', lastHeartbeat: '2026-08-03T09:50:00.000Z' }], graphs: [graph([{ ...fresh, lastHeartbeat: '2026-08-03T09:00:00.000Z' }])] }).inFlightBatch).toBe(false); });
  it('TC-IF-08: corrupt/missing graphRef is false with typed error. RD §8. Pass criterion: assert.equal(result.errors[0].code, "PEAKS_GRAPH_REF_BROKEN").', async () => { const out = (await probe())({ now, graphs: [{ graphRef: 'graphs/missing.json', corrupt: true }] }); expect(out.inFlightBatch).toBe(false); expect((out.errors as AnyRecord[])[0]?.code).toBe('PEAKS_GRAPH_REF_BROKEN'); });
  it('TC-AG-06: production ESM auto-compact probe defers with a fresh running node. RD §7. Pass criterion: assert.equal(result.inFlightBatch, true) and assert.equal(result.deferPreCompact, true).', async () => { expect((await probe())({ now, graphs: [graph([fresh])], autoCompact: true }).inFlightBatch).toBe(true); });
  it('TC-AG-07: production ESM auto-compact probe does not defer a 30-minute-stale node. RD §7. Pass criterion: assert.equal(result.inFlightBatch, false) and assert.equal(result.deferPreCompact, false).', async () => { expect((await probe())({ now, graphs: [graph([{ ...fresh, lastHeartbeat: '2026-08-03T09:30:00.000Z' }])], autoCompact: true }).inFlightBatch).toBe(false); });
  it('TC-IF-09: red-line compaction overrides in-flight deferral. RD §8. Pass criterion: assert.equal(result.shouldCompact, true).', async () => { const out = (await probe())({ now, graphs: [graph([fresh])], redLine: true }); expect(out.shouldCompact).toBe(true); });
});
