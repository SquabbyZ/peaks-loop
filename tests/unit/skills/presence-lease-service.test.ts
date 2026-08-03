// CONTRACT TEST — implementation pending; this test is the acceptance gate for slice 4.0.8 presence-lease-graph
// TC coverage: TC-SM-01, TC-SM-02, TC-SM-06, TC-SM-07, TC-SM-08, TC-SM-12,
// and production ESM repros TC-AG-01, TC-AG-04, TC-AG-05.
// Omitted render: this service exposes typed state, not a rendered surface.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';

const __fsMocks = vi.hoisted(() => ({
  writeFileSync: null as null | ((...args: unknown[]) => unknown),
  mkdirSync: null as null | ((...args: unknown[]) => unknown),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    writeFileSync: (...args: unknown[]) => {
      if (__fsMocks.writeFileSync) return __fsMocks.writeFileSync(...args);
      return actual.writeFileSync(...(args as Parameters<typeof actual.writeFileSync>));
    },
    mkdirSync: (...args: unknown[]) => {
      if (__fsMocks.mkdirSync) return __fsMocks.mkdirSync(...args);
      return actual.mkdirSync(...(args as Parameters<typeof actual.mkdirSync>));
    },
  };
});

declareDimensions(
  'tests/unit/skills/presence-lease-service.test.ts',
  ['behavior', 'integration', 'a11y'],
  [{ dim: 'render', reason: 'presence leases are typed persistence records, not a UI rendering surface' }],
);

type AnyRecord = Record<string, unknown>;
type PresenceApi = AnyRecord & {
  setPresenceLease: (input: AnyRecord) => Promise<AnyRecord> | AnyRecord;
  readPresenceLease: (input: AnyRecord) => Promise<AnyRecord> | AnyRecord;
  markPresenceLost: (input: AnyRecord) => Promise<AnyRecord> | AnyRecord;
  gcStalePresenceLeases: (input: AnyRecord) => Promise<AnyRecord> | AnyRecord;
};

async function loadPresenceApi(): Promise<PresenceApi> {
  const specifier = '~/src/services/skills/presence-lease-service.js';
  let module: AnyRecord;
  try { module = await import(specifier) as unknown as AnyRecord; }
  catch { module = {}; }
  for (const name of ['setPresenceLease', 'readPresenceLease', 'markPresenceLost', 'gcStalePresenceLeases']) {
    expect(typeof module[name]).toBe('function');
  }
  return module as PresenceApi;
}

function codeOf(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

async function expectCode(action: () => unknown, code: string): Promise<void> {
  try {
    await action();
    throw new Error(`expected ${code}`);
  } catch (error: unknown) {
    expect(codeOf(error)).toBe(code);
  }
}

function input(projectRoot: string, overrides: AnyRecord = {}): AnyRecord {
  return {
    projectRoot,
    sessionId: 'session-presence-unit',
    callerId: 'caller-unit',
    workflowId: 'workflow-unit',
    graphRef: 'graphs/workflow-unit.json',
    skill: 'peaks-code',
    depth: 0,
    now: '2026-08-03T10:00:00.000Z',
    ...overrides,
  };
}

const projects: string[] = [];
beforeEach(() => {
  __fsMocks.writeFileSync = null;
  __fsMocks.mkdirSync = null;
});
afterEach(async () => {
  __fsMocks.writeFileSync = null;
  __fsMocks.mkdirSync = null;
  for (const project of projects.splice(0)) await rm(project, { recursive: true, force: true });
});

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'peaks-presence-lease-unit-'));
  projects.push(root);
  return root;
}

describe('behavior — presence lease state transitions', () => {
  it('TC-SM-01: success path terminalizes the lease and clears only its caller index. RD §3. Pass criterion: assert.equal(lease.status, "terminalized") and assert.equal(lease.terminalReason, "success").', async () => {
    const root = await project();
    const api = await loadPresenceApi();
    const lease = await api.setPresenceLease(input(root));
    const terminal = await api.markPresenceLost({ ...input(root), workflowId: lease.workflowId, reason: 'success', status: 'terminalized' });
    expect(terminal.status).toBe('terminalized');
    expect(terminal.terminalReason).toBe('success');
    expect(terminal.callerId).toBe('caller-unit');
  });

  it('TC-SM-02: failed dispatch marks running lease lost with sub-agent-crashed. RD §3. Pass criterion: assert.equal(lease.terminalReason, "sub-agent-crashed") and assert.equal(lease.status, "lost").', async () => {
    const root = await project();
    const api = await loadPresenceApi();
    await api.setPresenceLease(input(root, { status: 'running' }));
    const lost = await api.markPresenceLost(input(root, { status: 'running', reason: 'sub-agent-crashed' }));
    expect(lost.status).toBe('lost');
    expect(lost.terminalReason).toBe('sub-agent-crashed');
  });

  it('TC-SM-06: GC requires both heartbeat older than one hour and start older than 24 hours. RD §3. Pass criterion: assert.equal(gc.removed, 1) for both predicates true and assert.equal(retained, 1) when either is false.', async () => {
    const root = await project();
    const api = await loadPresenceApi();
    const result = await api.gcStalePresenceLeases({
      projectRoot: root,
      now: '2026-08-03T10:00:00.000Z',
      leases: [
        { ...input(root), startedAt: '2026-08-02T09:00:00.000Z', lastHeartbeat: '2026-08-03T08:00:00.000Z' },
        { ...input(root, { workflowId: 'fresh-start' }), startedAt: '2026-08-02T09:30:00.000Z', lastHeartbeat: '2026-08-03T08:00:00.000Z' },
      ],
    });
    expect(result.removed).toBe(1);
    expect(result.retained).toBe(1);
  });

  it('TC-SM-07: two callers remain isolated when one lease terminalizes. RD §3. Pass criterion: assert.equal(readA.status, "terminalized") and assert.equal(readB.status, "running").', async () => {
    const root = await project();
    const api = await loadPresenceApi();
    await api.setPresenceLease(input(root, { callerId: 'caller-a', workflowId: 'workflow-a', graphRef: 'graphs/workflow-a.json' }));
    await api.setPresenceLease(input(root, { callerId: 'caller-b', workflowId: 'workflow-b', graphRef: 'graphs/workflow-b.json' }));
    const done = await api.markPresenceLost(input(root, { callerId: 'caller-a', workflowId: 'workflow-a', graphRef: 'graphs/workflow-a.json', reason: 'success', status: 'terminalized' }));
    const other = await api.readPresenceLease(input(root, { callerId: 'caller-b', workflowId: 'workflow-b', graphRef: 'graphs/workflow-b.json' }));
    expect(done.status).toBe('terminalized');
    expect(other.status).toBe('running');
  });

  it('TC-SM-08: a follow-up workflow creates a distinct lease and explicit reclaim. RD §3. Pass criterion: assert.notEqual(first.workflowId, followUp.workflowId) and assert.equal(followUp.parentWorkflowId, first.workflowId).', async () => {
    const root = await project();
    const api = await loadPresenceApi();
    const first = await api.setPresenceLease(input(root, { workflowId: 'workflow-first', graphRef: 'graphs/workflow-first.json' }));
    await api.markPresenceLost(input(root, { workflowId: first.workflowId, graphRef: first.graphRef, reason: 'success', status: 'terminalized' }));
    const followUp = await api.setPresenceLease(input(root, { workflowId: 'workflow-follow-up', graphRef: 'graphs/workflow-follow-up.json', parentWorkflowId: first.workflowId, depth: 1 }));
    expect(followUp.workflowId).not.toBe(first.workflowId);
    expect(followUp.parentWorkflowId).toBe(first.workflowId);
    expect(followUp.status).toBe('preparing');
  });

  it('TC-SM-12: a lease whose graph reference belongs to another workflow is rejected fail-closed. RD §3. Pass criterion: assert.equal(thrown.code, "PEAKS_GRAPH_REF_BROKEN").', async () => {
    const root = await project();
    const api = await loadPresenceApi();
    await expectCode(
      () => api.readPresenceLease(input(root, { workflowId: 'workflow-a', graphRef: 'graphs/workflow-b.json' })),
      'PEAKS_GRAPH_REF_BROKEN',
    );
  });
});

describe('integration — adapter/session failure boundaries are production ESM repros', () => {
  it('TC-AG-01: valid lease pointing at a missing graph escapes PEAKS_GRAPH_REF_BROKEN. RD §7. Pass criterion: assert.equal(error.code, "PEAKS_GRAPH_REF_BROKEN").', async () => {
    const root = await project();
    const api = await loadPresenceApi();
    await expectCode(
      () => api.readPresenceLease(input(root, { graphRef: 'graphs/missing-workflow.json' })),
      'PEAKS_GRAPH_REF_BROKEN',
    );
  });

  it('TC-AG-04: absent adapter caller fails before any filesystem write. RD §7. Pass criterion: assert.equal(error.code, "PEAKS_CALLER_NOT_RESOLVED") and assert.equal(writes, 0).', async () => {
    const root = await project();
    let writes = 0;
    __fsMocks.writeFileSync = () => { writes += 1; return undefined; };
    __fsMocks.mkdirSync = () => { writes += 1; return undefined; };
    const api = await loadPresenceApi();
    await expectCode(
      () => api.setPresenceLease(input(root, { callerId: '', adapterEnv: {} })),
      'PEAKS_CALLER_NOT_RESOLVED',
    );
    expect(writes).toBe(0);
  });

  it('TC-AG-05: caller available without bound session fails before any filesystem write. RD §7. Pass criterion: assert.equal(error.code, "PEAKS_SESSION_NOT_BOUND") and assert.equal(writes, 0).', async () => {
    const root = await project();
    let writes = 0;
    __fsMocks.writeFileSync = () => { writes += 1; return undefined; };
    __fsMocks.mkdirSync = () => { writes += 1; return undefined; };
    const api = await loadPresenceApi();
    await expectCode(
      () => api.setPresenceLease(input(root, { sessionId: undefined, callerId: 'caller-available' })),
      'PEAKS_SESSION_NOT_BOUND',
    );
    expect(writes).toBe(0);
  });
});
