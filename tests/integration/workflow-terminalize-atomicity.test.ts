// CONTRACT TEST — implementation pending; this test is the acceptance gate for slice 4.0.8 presence-lease-graph
// TC coverage: TC-AG-08. The fault injection must throw on the second writeFileSync call.
// Omitted render: terminalization is a persistence transaction, not a rendered surface.

import { describe, expect, it, vi } from 'vitest';

const __fsMocks = vi.hoisted(() => ({ writes: 0 }));
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      __fsMocks.writes += 1;
      if (__fsMocks.writes === 2) throw new Error('injected second-write failure');
      return actual.writeFileSync(...args);
    },
  };
});

type AnyRecord = Record<string, unknown>;
function codeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

describe('workflow terminalize atomicity', () => {
  it('TC-AG-08: second write failure leaves no half-terminalized state or success event. RD §7. Pass criterion: assert.equal(error.code, "PEAKS_TERMINALIZE_ATOMICITY_FAILED"), assert.equal(result.successEventCount, 0), and assert.equal(result.consistent, true).', async () => {
    __fsMocks.writes = 0;
    const module = await import('../../src/services/workflow/workflow-presence-lifecycle.js') as unknown as AnyRecord;
    expect(typeof module.terminalizeWorkflow).toBe('function');
    try {
      await (module.terminalizeWorkflow as (input: AnyRecord) => Promise<AnyRecord>)({
        projectRoot: 'terminalize-atomicity-project', sessionId: 'terminalize-session', callerId: 'terminalize-caller', workflowId: 'terminalize-workflow', graphRef: 'graphs/terminalize-workflow.json', reason: 'success',
      });
      throw new Error('expected atomicity failure');
    } catch (error: unknown) {
      expect(codeOf(error)).toBe('PEAKS_TERMINALIZE_ATOMICITY_FAILED');
      const details = error as { successEventCount?: number; consistent?: boolean };
      expect(details.successEventCount).toBe(0);
      expect(details.consistent).toBe(true);
    }
  });
});
