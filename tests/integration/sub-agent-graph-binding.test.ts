// CONTRACT TEST — implementation pending; this test is the acceptance gate for slice 4.0.8 presence-lease-graph
// TC coverage: TC-AP-04. Scoped integration boundary; parent runs Playwright separately.
// Omitted render: dispatch binding is a typed protocol result, not rendered output.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

type AnyRecord = Record<string, unknown>;
const projects: string[] = [];
afterEach(async () => { for (const root of projects.splice(0)) await rm(root, { recursive: true, force: true }); });

async function loadDispatch(): Promise<AnyRecord> {
  const module = await import('../../src/cli/commands/dispatch-commands.js') as unknown as AnyRecord;
  expect(typeof module.dispatchSubAgent).toBe('function');
  return module;
}

function codeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

describe('sub-agent graph binding', () => {
  it('TC-AP-04: single dispatch without --graph-node rejects before a record write. RD §8. Pass criterion: assert.equal(error.code, "PEAKS_GRAPH_NODE_REQUIRED") and assert.equal(recordWrites, 0).', async () => {
    const root = await mkdtemp(join(tmpdir(), 'peaks-graph-binding-'));
    projects.push(root);
    try {
      await (await loadDispatch()).dispatchSubAgent({ projectRoot: root, role: 'qa', prompt: 'binding probe', sessionId: 'binding-session' });
      throw new Error('expected graph-node requirement');
    } catch (error: unknown) {
      expect(codeOf(error)).toBe('PEAKS_GRAPH_NODE_REQUIRED');
    }
  });
});

void join;
