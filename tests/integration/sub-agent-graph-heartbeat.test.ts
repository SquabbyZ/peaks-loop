// CONTRACT TEST — implementation pending; this test is the acceptance gate for slice 4.0.8 presence-lease-graph
// TC coverage: TC-AP-05 and TC-SM-02. Scoped integration boundary; no Playwright E2E.
// Omitted render: heartbeat results are typed lifecycle records.

import { describe, expect, it, vi } from 'vitest';

type AnyRecord = Record<string, unknown>;
type HeartbeatApi = AnyRecord & { heartbeat: (input: AnyRecord) => Promise<AnyRecord> | AnyRecord; markLost: (input: AnyRecord) => Promise<AnyRecord> | AnyRecord };

const __fsMocks = vi.hoisted(() => ({ writeFileSync: null as null | ((...args: unknown[]) => unknown) }));
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, writeFileSync: (...args: unknown[]) => __fsMocks.writeFileSync?.(...args) ?? actual.writeFileSync(...(args as Parameters<typeof actual.writeFileSync>)) };
});

async function api(): Promise<HeartbeatApi> {
  const module = await import('../../src/cli/commands/heartbeat-commands.js') as unknown as AnyRecord;
  expect(typeof module.heartbeat).toBe('function');
  expect(typeof module.markLost).toBe('function');
  return module as HeartbeatApi;
}

describe('sub-agent graph heartbeat', () => {
  it('TC-AP-05: first heartbeat is the only dispatched → running transition. RD §8. Pass criterion: assert.equal(first.status, "running") and assert.equal(second.status, "running").', async () => {
    const service = await api();
    const first = await service.heartbeat({ dispatchRef: 'dispatch/one.json', graphNodeId: 'node-one', status: 'dispatched', now: '2026-08-03T10:00:00.000Z' });
    const second = await service.heartbeat({ dispatchRef: 'dispatch/one.json', graphNodeId: 'node-one', status: 'running', now: '2026-08-03T10:00:30.000Z' });
    expect(first.status).toBe('running');
    expect(second.status).toBe('running');
    expect(second.lastHeartbeat).toBe('2026-08-03T10:00:30.000Z');
  });

  it('TC-SM-02: terminal-failed dispatch becomes lost with sub-agent-crashed. RD §3. Pass criterion: assert.equal(result.status, "lost") and assert.equal(result.terminalReason, "sub-agent-crashed").', async () => {
    const service = await api();
    const result = await service.markLost({ dispatchRef: 'dispatch/failed.json', graphNodeId: 'node-failed', status: 'running', reason: 'sub-agent-crashed' });
    expect(result.status).toBe('lost');
    expect(result.terminalReason).toBe('sub-agent-crashed');
  });
});

void __fsMocks;
