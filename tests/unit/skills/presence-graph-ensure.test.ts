// CONTRACT TEST — the presence lease write path creates the graph it names,
// and the terminalize path repairs a graph that was never written while a
// corrupt graph still fails closed.
// Omitted render: the contract is about persisted records and their error
// codes, not about a rendered surface.

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import {
  setPresenceLease,
  type SetPresenceLeaseInput
} from '~/src/services/skills/presence-lease-service.js';
import {
  terminalizeWorkflow,
  type TerminalizeWorkflowInput
} from '~/src/services/workflow/workflow-presence-lifecycle.js';

declareDimensions(
  'tests/unit/skills/presence-graph-ensure.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason: 'the contract is persisted records and typed error codes, not a rendered surface'
    }
  ]
);

const SESSION_ID = 'session-pg-001';
const CALLER_ID = 'caller-pg-001';
const WORKFLOW_ID = 'workflow-pg-001';

const projects: string[] = [];

afterEach(() => {
  for (const project of projects.splice(0)) rmSync(project, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-presence-graph-ensure-'));
  projects.push(root);
  return root;
}

function sessionRoot(root: string): string {
  return join(root, '.peaks', '_runtime', SESSION_ID);
}

function graphPath(root: string, workflowId = WORKFLOW_ID): string {
  return join(sessionRoot(root), 'graphs', `${workflowId}.json`);
}

function leaseDir(root: string): string {
  return join(sessionRoot(root), 'leases');
}

function leaseInput(
  root: string,
  overrides: Partial<SetPresenceLeaseInput> = {}
): SetPresenceLeaseInput {
  return {
    projectRoot: root,
    sessionId: SESSION_ID,
    callerId: CALLER_ID,
    workflowId: WORKFLOW_ID,
    graphRef: `graphs/${WORKFLOW_ID}.json`,
    skill: 'peaks-code',
    now: '2026-10-24T00:00:00.000Z',
    ...overrides
  };
}

function terminalizeInput(
  root: string,
  overrides: Partial<TerminalizeWorkflowInput> = {}
): TerminalizeWorkflowInput {
  return {
    projectRoot: root,
    sessionId: SESSION_ID,
    callerId: CALLER_ID,
    workflowId: WORKFLOW_ID,
    graphRef: `graphs/${WORKFLOW_ID}.json`,
    reason: 'success',
    ...overrides
  };
}

function codeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const value = (error as { code?: unknown }).code;
  return typeof value === 'string' ? value : undefined;
}

describe('Scenario: behavior — the lease write path creates the graph it names', () => {
  it('when invoked, should TC-PG-01: writing a lease puts the graph it points at on disk. Pass criterion: assert.equal(existsSync(graphPath(root)), true) and assert.equal(graph.workflowId, WORKFLOW_ID).', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const root = project();
    setPresenceLease(leaseInput(root));
    expect(existsSync(graphPath(root))).toBe(true);
    const graph = JSON.parse(readFileSync(graphPath(root), 'utf8')) as Record<string, unknown>;
    expect(graph.workflowId).toBe(WORKFLOW_ID);
    expect(graph.rootSkill).toBe('peaks-code');
  });

  it('when invoked, should TC-PG-02: writing the same lease twice keeps one lease and one graph. Pass criterion: assert.equal(leaseFiles.length, 1) and assert.equal(graphFiles.length, 1).', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const root = project();
    setPresenceLease(leaseInput(root));
    setPresenceLease(leaseInput(root));
    const leaseFiles = readdirSync(leaseDir(root));
    const graphFiles = readdirSync(join(sessionRoot(root), 'graphs'));
    expect(leaseFiles).toHaveLength(1);
    expect(graphFiles).toHaveLength(1);
    expect(graphFiles[0]).toBe(`${WORKFLOW_ID}.json`);
  });

  it('when invoked, should TC-PG-03: terminalize succeeds for a lease whose graph was never written. Pass criterion: assert.equal(result.lease.status, "terminalized") and assert.equal(existsSync(graphPath(root)), true).', async () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const root = project();
    setPresenceLease(leaseInput(root));
    rmSync(graphPath(root), { force: true });
    const result = await terminalizeWorkflow(terminalizeInput(root));
    expect(result.lease.status).toBe('terminalized');
    expect(result.lease.terminalReason).toBe('success');
    expect(existsSync(graphPath(root))).toBe(true);
    const graph = JSON.parse(readFileSync(graphPath(root), 'utf8')) as {
      nodes: { kind: string; status: string }[];
    };
    expect(graph.nodes.find((node) => node.kind === 'terminal')?.status).toBe('terminalized');
  });
});

describe('Scenario: integration — the graph file on disk is the contract', () => {
  it('when invoked, should TC-PG-04: a graph that exists but is corrupt is not rewritten. Pass criterion: assert.equal(readFileSync(graphPath(root), "utf8"), corrupt) and assert.equal(codeOf(error), "PEAKS_TERMINALIZE_ATOMICITY_FAILED").', async () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const root = project();
    setPresenceLease(leaseInput(root));
    const corrupt = '{ this is not json';
    writeFileSync(graphPath(root), corrupt, 'utf8');
    let code: string | undefined;
    try {
      await terminalizeWorkflow(terminalizeInput(root));
    } catch (error: unknown) {
      code = codeOf(error);
    }
    expect(code).toBe('PEAKS_TERMINALIZE_ATOMICITY_FAILED');
    expect(readFileSync(graphPath(root), 'utf8')).toBe(corrupt);
  });

  it('when invoked, should TC-PG-05: terminalize for a workflow the lease does not carry is refused. Pass criterion: assert.equal(codeOf(error), "PEAKS_TERMINALIZE_ATOMICITY_FAILED") and assert.equal(existsSync(graphPath(root, "workflow-pg-002")), false).', async () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const root = project();
    setPresenceLease(leaseInput(root));
    let code: string | undefined;
    try {
      await terminalizeWorkflow(
        terminalizeInput(root, {
          workflowId: 'workflow-pg-002',
          graphRef: 'graphs/workflow-pg-002.json'
        })
      );
    } catch (error: unknown) {
      code = codeOf(error);
    }
    expect(code).toBe('PEAKS_TERMINALIZE_ATOMICITY_FAILED');
    expect(existsSync(graphPath(root, 'workflow-pg-002'))).toBe(false);
  });
});

describe('Scenario: a11y — the refusals keep a typed code for the operator', () => {
  it('when invoked, should TC-PG-06: a graph reference that does not match the workflow id is refused before any write. Pass criterion: assert.equal(codeOf(error), "PEAKS_GRAPH_REF_BROKEN") and assert.equal(existsSync(graphPath(root)), false).', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const root = project();
    let code: string | undefined;
    try {
      setPresenceLease(leaseInput(root, { graphRef: 'graphs/workflow-other.json' }));
    } catch (error: unknown) {
      code = codeOf(error);
    }
    expect(code).toBe('PEAKS_GRAPH_REF_BROKEN');
    expect(existsSync(graphPath(root))).toBe(false);
  });
});
