// CONTRACT TEST — implementation pending; this test is the acceptance gate for slice 4.0.8 presence-lease-graph
// TC coverage: TC-SM-09 plus migration idempotency. Scoped integration boundary.
// Omitted render: reconcile emits migration receipts, not UI output.

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

type AnyRecord = Record<string, unknown>;
const projects: string[] = [];
afterEach(async () => { for (const root of projects.splice(0)) await rm(root, { recursive: true, force: true }); });

async function reconcileApi(): Promise<AnyRecord> {
  const module = await import('../../src/services/workspace/reconcile-service.js') as unknown as AnyRecord;
  expect(typeof module.reconcilePresenceLeases).toBe('function');
  return module;
}

describe('workspace reconcile presence leases', () => {
  it('TC-SM-09: canonical malformed plus valid legacy records a conflict instead of fake-green fallback. RD §3. Pass criterion: assert.equal(result.conflicts[0].code, "PEAKS_GRAPH_CORRUPTED") and assert.equal(result.legacyPresence, false).', async () => {
    const root = await mkdtemp(join(tmpdir(), 'peaks-reconcile-presence-')); projects.push(root);
    await mkdir(join(root, '.peaks', '_runtime'), { recursive: true });
    await writeFile(join(root, '.peaks', '_runtime', 'active-skill.json'), '{broken', 'utf8');
    await writeFile(join(root, '.peaks', '_runtime', 'legacy-active-skill.json'), JSON.stringify({ skill: 'peaks-code', active: true }), 'utf8');
    const result = await (await reconcileApi()).reconcilePresenceLeases({ projectRoot: root, sessionId: 'reconcile-session', callerId: 'reconcile-caller' });
    expect(result.conflicts?.[0]?.code).toBe('PEAKS_GRAPH_CORRUPTED');
    expect(result.legacyPresence).toBe(false);
  });

  it('migration is idempotent and creates no duplicate targets on the second run. RD §6. Pass criterion: assert.equal(first.migratedCount, second.migratedCount) and assert.equal(second.createdCount, 0).', async () => {
    const root = await mkdtemp(join(tmpdir(), 'peaks-reconcile-idempotent-')); projects.push(root);
    await mkdir(join(root, '.peaks', '_runtime'), { recursive: true });
    await writeFile(join(root, '.peaks', '_runtime', 'active-skill.json'), JSON.stringify({ skill: 'peaks-code', active: true }), 'utf8');
    const service = await reconcileApi();
    const first = await service.reconcilePresenceLeases({ projectRoot: root, sessionId: 'reconcile-session', callerId: 'reconcile-caller' });
    const second = await service.reconcilePresenceLeases({ projectRoot: root, sessionId: 'reconcile-session', callerId: 'reconcile-caller' });
    expect(second.migratedCount).toBe(first.migratedCount);
    expect(second.createdCount).toBe(0);
  });
});

void (null as unknown as AnyRecord | null);
