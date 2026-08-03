import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runJ07Contract } from '~/src/services/capability-guard-runner/contracts/J07';

const REPO = resolve(__dirname, '..', '..', '..');

describe('J07 test-runner-fidelity contract', () => {
  it('peaks test is registered and delegates to vitest', async () => {
    const r = await runJ07Contract({ projectRoot: REPO, sessionId: 'J07', contract: {} as any, baselineInvariant: 'J07#1' });
    expect(r.status).toBe('pass');
  });
});