import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runJ14Contract } from '~/src/services/capability-guard-runner/contracts/J14';

const REPO = resolve(__dirname, '..', '..', '..');

describe('J14 issue-orchestrator-trace contract', () => {
  it('keeps the issue-sweep surface with at least 2 of the 4 stages', async () => {
    const r = await runJ14Contract({ projectRoot: REPO, sessionId: 'J14', contract: {} as any, baselineInvariant: 'J14#1' });
    expect(r.status).toBe('pass');
  });
});
