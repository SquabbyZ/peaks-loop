import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runJ03Contract } from '~/src/services/capability-guard-runner/contracts/J03';

const REPO = resolve(__dirname, '..', '..', '..');

describe('J03 problem-resolution-flow contract', () => {
  it('keeps the 4-dim shape on the final-review types', async () => {
    const r = await runJ03Contract({ projectRoot: REPO, sessionId: 'J03', contract: {} as any, baselineInvariant: 'J03#1' });
    expect(r.status).toBe('pass');
  });
});