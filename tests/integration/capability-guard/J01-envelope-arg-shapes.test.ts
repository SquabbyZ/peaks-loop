import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runJ01Contract } from '~/src/services/capability-guard-runner/contracts/J01';

const REPO = resolve(__dirname, '..', '..', '..');

describe('J01 envelope-arg-shapes contract', () => {
  it('routes every fixture case to the same skill as the baseline', async () => {
    const r = await runJ01Contract({ projectRoot: REPO, sessionId: 'J01', contract: {} as any, baselineInvariant: 'J01#1' });
    expect(r.status).toBe('pass');
  });
  it('reports a diff when a routing case breaks', async () => {
    process.env.PEAKS_BIN_OVERRIDE = 'nonexistent';
    const r = await runJ01Contract({ projectRoot: REPO, sessionId: 'J01', contract: {} as any, baselineInvariant: 'J01#1' });
    delete process.env.PEAKS_BIN_OVERRIDE;
    expect(r.status).toBe('fail');
    expect(r.diff?.reason).toMatch(/J01#/);
  });
});