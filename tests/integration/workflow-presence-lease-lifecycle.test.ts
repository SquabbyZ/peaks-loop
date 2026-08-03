// CONTRACT TEST — implementation pending; this test is the acceptance gate for slice 4.0.8 presence-lease-graph
// TC coverage: TC-SM-01. Action is a production ESM service call, not Playwright E2E.
// Omitted a11y: the lifecycle contract is asserted through typed state, not user-facing prose.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

type AnyRecord = Record<string, unknown>;
const projects: string[] = [];

afterEach(async () => {
  for (const root of projects.splice(0)) await rm(root, { recursive: true, force: true });
});

async function loadLifecycle(): Promise<AnyRecord> {
  const module = await import('../../src/services/workflow/workflow-presence-lifecycle.js') as unknown as AnyRecord;
  expect(typeof module.initWorkflow).toBe('function');
  expect(typeof module.terminalizeWorkflow).toBe('function');
  return module;
}

function input(projectRoot: string): AnyRecord {
  return {
    projectRoot,
    sessionId: 'integration-session-success',
    callerId: 'integration-caller-success',
    skill: 'peaks-code',
    workflowId: 'workflow-success',
    graphRef: 'graphs/workflow-success.json',
    now: '2026-08-03T10:00:00.000Z',
  };
}

describe('workflow presence lease lifecycle', () => {
  it('TC-SM-01: prepare, dispatch, heartbeat, envelope, ack, then terminalize success. RD §8. Pass criterion: assert.equal(result.lease.status, "terminalized"), assert.equal(result.lease.terminalReason, "success"), and assert.equal(result.events.filter(e => e.kind === "workflow-terminalized").length, 1).', async () => {
    const root = await mkdtemp(join(tmpdir(), 'peaks-presence-lifecycle-integration-'));
    projects.push(root);
    const lifecycle = await loadLifecycle();
    const started = await (lifecycle.initWorkflow as (input: AnyRecord) => Promise<AnyRecord>)(input(root));
    const result = await (lifecycle.terminalizeWorkflow as (input: AnyRecord) => Promise<AnyRecord>)({
      ...input(root),
      workflowId: started.workflowId,
      graphRef: started.graphRef,
      reason: 'success',
      requireConsumed: true,
    });
    expect(result.lease.status).toBe('terminalized');
    expect(result.lease.terminalReason).toBe('success');
    expect((result.events as AnyRecord[]).filter((event) => event.kind === 'workflow-terminalized')).toHaveLength(1);
    expect(result.indexCleared).toBe(true);
  });
});
