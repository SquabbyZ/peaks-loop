import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runJ12Contract } from '~/src/services/capability-guard-runner/contracts/J12';

const REPO = resolve(__dirname, '..', '..', '..');

describe('J12 lease-lifecycle contract', () => {
  it('keeps a worktree/lease service that references both lease and release', async () => {
    const r = await runJ12Contract({ projectRoot: REPO, sessionId: 'J12', contract: {} as any, baselineInvariant: 'J12#1' });
    expect(r.status).toBe('pass');
  });
});
