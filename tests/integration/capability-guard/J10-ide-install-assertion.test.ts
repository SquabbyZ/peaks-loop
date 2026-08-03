import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runJ10Contract } from '~/src/services/capability-guard-runner/contracts/J10';

const REPO = resolve(__dirname, '..', '..', '..');

describe('J10 ide-install-assertion contract', () => {
  it('keeps hooks/ide/adapter infrastructure', async () => {
    const r = await runJ10Contract({ projectRoot: REPO, sessionId: 'J10', contract: {} as any, baselineInvariant: 'J10#1' });
    expect(r.status).toBe('pass');
  });
});
