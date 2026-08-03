import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runJ05Contract } from '~/src/services/capability-guard-runner/contracts/J05';

const REPO = resolve(__dirname, '..', '..', '..');

describe('J05 final-review-shape contract', () => {
  it('keeps the 4-dim string fragments in final-review-service.ts', async () => {
    const r = await runJ05Contract({ projectRoot: REPO, sessionId: 'J05', contract: {} as any, baselineInvariant: 'J05#1' });
    expect(r.status).toBe('pass');
  });
});