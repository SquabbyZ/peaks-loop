// CONTRACT TEST — implementation pending; this test is the acceptance gate for slice 4.0.8 presence-lease-graph
// TC coverage: TC-IF-01..09.
// Omitted render: this probe returns graph-derived state, not UI output.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/workflow/workflow-inflight-probe.test.ts',
  ['behavior', 'a11y'],
  [
    { dim: 'render', reason: 'in-flight is a typed decision, not rendered output' },
    { dim: 'integration', reason: 'fixture graphs are passed as pure inputs in this unit boundary' },
  ],
);

type AnyRecord = Record<string, unknown>;
type ProbeApi = AnyRecord & { probeInFlightBatch: (input: AnyRecord) => AnyRecord };

async function loadProbe(): Promise<ProbeApi> {
  const module = await import('~/src/services/workflow/workflow-inflight-probe.js') as unknown as AnyRecord;
  expect(typeof module.probeInFlightBatch).toBe('function');
  return module as ProbeApi;
}

const fresh = '2026-08-03T09:40:01.000Z';
const now = '2026-08-03T10:00:00.000Z';
const node = (status: string, lastHeartbeat?: string): AnyRecord => ({ id: 'dispatch-1', kind: 'dispatch', status, ...(lastHeartbeat ? { lastHeartbeat } : {}) });
const graph = (nodes: AnyRecord[], workflowId = 'workflow-1'): AnyRecord => ({ workflowId, rootSkill: 'peaks-code', nodes, edges: [], schemaVersion: 1 });
function resultOf(out: AnyRecord): boolean { return out.inFlightBatch === true; }

describe('behavior — graph-backed inFlightBatch truth', () => {
  it('TC-IF-01: one fresh running node returns true. RD §8. Pass criterion: assert.equal(result.inFlightBatch, true).', async () => { const out = (await loadProbe()).probeInFlightBatch({ now, graphs: [graph([node('running', fresh)])] }); expect(resultOf(out)).toBe(true); });
  it('TC-IF-02: multiple graphs are true when any running node is fresh. RD §8. Pass criterion: assert.equal(result.inFlightBatch, true).', async () => { const out = (await loadProbe()).probeInFlightBatch({ now, graphs: [graph([node('terminalized')], 'done'), graph([node('running', fresh)], 'active')] }); expect(resultOf(out)).toBe(true); });
  it('TC-IF-03: non-running statuses never report in-flight. RD §8. Pass criterion: assert.equal(result.inFlightBatch, false).', async () => { const statuses = ['prepared', 'dispatched', 'envelope-received', 'consumed-by-parent', 'terminalized', 'lost']; const out = (await loadProbe()).probeInFlightBatch({ now, graphs: [graph(statuses.map((status) => node(status, fresh)))] }); expect(resultOf(out)).toBe(false); });
  it('TC-IF-04: heartbeat at 29:59 is fresh. RD §8. Pass criterion: assert.equal(result.inFlightBatch, true).', async () => { const out = (await loadProbe()).probeInFlightBatch({ now, graphs: [graph([node('running', '2026-08-03T09:30:01.000Z')])] }); expect(resultOf(out)).toBe(true); });
  it('TC-IF-05: heartbeat at 30:00 is stale. RD §8. Pass criterion: assert.equal(result.inFlightBatch, false).', async () => { const out = (await loadProbe()).probeInFlightBatch({ now, graphs: [graph([node('running', '2026-08-03T09:30:00.000Z')])] }); expect(resultOf(out)).toBe(false); });
  it('TC-IF-06: running node without heartbeat is false with diagnostic warning. RD §8. Pass criterion: assert.equal(result.inFlightBatch, false) and assert.equal(result.warnings[0].code, "PEAKS_HEARTBEAT_MISSING").', async () => { const out = (await loadProbe()).probeInFlightBatch({ now, graphs: [graph([node('running')])] }); expect(resultOf(out)).toBe(false); expect((out.warnings as AnyRecord[])[0]?.code).toBe('PEAKS_HEARTBEAT_MISSING'); });
  it('TC-IF-07: fresh lease with stale running node is false. RD §8. Pass criterion: assert.equal(result.inFlightBatch, false).', async () => { const out = (await loadProbe()).probeInFlightBatch({ now, leases: [{ startedAt: fresh, lastHeartbeat: fresh, status: 'running' }], graphs: [graph([node('running', '2026-08-03T09:00:00.000Z')])] }); expect(resultOf(out)).toBe(false); });
  it('TC-IF-08: corrupt or missing graphRef is false with typed diagnostic. RD §8. Pass criterion: assert.equal(result.inFlightBatch, false) and assert.equal(result.errors[0].code, "PEAKS_GRAPH_REF_BROKEN").', async () => { const out = (await loadProbe()).probeInFlightBatch({ now, graphs: [{ graphRef: 'graphs/missing.json', corrupt: true }] }); expect(resultOf(out)).toBe(false); expect((out.errors as AnyRecord[])[0]?.code).toBe('PEAKS_GRAPH_REF_BROKEN'); });
  it('TC-IF-09: red-line compaction remains an override over in-flight deferral. RD §8. Pass criterion: assert.equal(result.shouldCompact, true).', async () => { const out = (await loadProbe()).probeInFlightBatch({ now, graphs: [graph([node('running', fresh)])], redLine: true }); expect(out.shouldCompact).toBe(true); expect(out.inFlightBatch).toBe(true); });
});

describe('a11y — probe diagnostics are inspectable', () => {
  it('uses a typed warning for missing heartbeat rather than silent false. RD §8. Pass criterion: assert.equal(result.warnings[0].code, "PEAKS_HEARTBEAT_MISSING").', async () => { const out = (await loadProbe()).probeInFlightBatch({ now, graphs: [graph([node('running')])] }); expect((out.warnings as AnyRecord[])[0]?.code).toBe('PEAKS_HEARTBEAT_MISSING'); });
});
