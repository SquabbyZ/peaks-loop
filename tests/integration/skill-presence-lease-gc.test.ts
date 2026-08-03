// CONTRACT TEST — implementation pending; this test is the acceptance gate for slice 4.0.8 presence-lease-graph
// TC coverage: TC-SM-06 and all three GC triggers: presence:set, workspace init, manual GC.
// Omitted render: GC returns lifecycle counts, not rendered output.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

type AnyRecord = Record<string, unknown>;
const projects: string[] = [];
afterEach(async () => { for (const root of projects.splice(0)) await rm(root, { recursive: true, force: true }); });

async function loadGc(): Promise<AnyRecord> {
  const module = await import('../../src/services/skills/presence-lease-service.js') as unknown as AnyRecord;
  for (const name of ['setPresenceLease', 'gcStalePresenceLeases']) expect(typeof module[name]).toBe('function');
  return module;
}

const stale = { workflowId: 'stale', callerId: 'caller', sessionId: 'session', startedAt: '2026-08-01T00:00:00.000Z', lastHeartbeat: '2026-08-01T01:00:00.000Z', graphRef: 'graphs/stale.json', status: 'running' };

describe('presence lease GC integration', () => {
  it('TC-SM-06: both age predicates are required for removal. RD §8. Pass criterion: assert.equal(result.removed, 1) and assert.equal(result.retained, 2).', async () => {
    const root = await mkdtemp(join(tmpdir(), 'peaks-presence-gc-')); projects.push(root);
    const service = await loadGc();
    const result = await service.gcStalePresenceLeases({ projectRoot: root, now: '2026-08-03T10:00:00.000Z', leases: [stale, { ...stale, workflowId: 'young', startedAt: '2026-08-02T20:00:00.000Z' }, { ...stale, workflowId: 'fresh-beat', lastHeartbeat: '2026-08-03T09:30:00.000Z' }] });
    expect(result.removed).toBe(1);
    expect(result.retained).toBe(2);
  });

  it('runs the same stale sweep before presence:set. RD §3. Pass criterion: assert.equal(result.gc.removed, 1) before assert.equal(result.lease.status, "preparing").', async () => {
    const root = await mkdtemp(join(tmpdir(), 'peaks-presence-set-gc-')); projects.push(root);
    const service = await loadGc();
    const result = await service.setPresenceLease({ projectRoot: root, sessionId: 'session', callerId: 'caller', workflowId: 'fresh', graphRef: 'graphs/fresh.json', skill: 'peaks-code', now: '2026-08-03T10:00:00.000Z', staleLeases: [stale] });
    expect(result.gc?.removed).toBe(1);
    expect(result.lease?.status ?? result.status).toBe('preparing');
  });

  it('workspace-init trigger invokes the same GC service before binding a new lease. RD §3. Pass criterion: assert.equal(result.trigger, "workspace-init") and assert.equal(result.removed, 1).', async () => {
    const service = await loadGc();
    const result = await service.gcStalePresenceLeases({ projectRoot: 'workspace-init-project', trigger: 'workspace-init', now: '2026-08-03T10:00:00.000Z', leases: [stale] });
    expect(result.trigger).toBe('workspace-init');
    expect(result.removed).toBe(1);
  });

  it('manual GC is explicit and does not treat missing graph evidence as live work. RD §4. Pass criterion: assert.equal(result.inFlightBatch, false) and assert.equal(result.warnings[0].code, "PEAKS_GRAPH_REF_BROKEN").', async () => {
    const root = await mkdtemp(join(tmpdir(), 'peaks-presence-manual-gc-')); projects.push(root);
    const service = await loadGc();
    const result = await service.gcStalePresenceLeases({ projectRoot: root, trigger: 'manual', now: '2026-08-03T10:00:00.000Z', leases: [{ ...stale, graphRef: 'graphs/missing.json' }] });
    expect(result.inFlightBatch).toBe(false);
    expect(result.warnings?.[0]?.code).toBe('PEAKS_GRAPH_REF_BROKEN');
  });
});
