import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runJ04Contract } from '~/src/services/capability-guard-runner/contracts/J04';

const REPO = resolve(__dirname, '..', '..', '..');

describe('J04 audit-goal-binding contract', () => {
  it('registers the audit goal subcommand and rejects empty input', async () => {
    const r = await runJ04Contract({ projectRoot: REPO, sessionId: 'J04', contract: {} as any, baselineInvariant: 'J04#1' });
    expect(r.status).toBe('pass');
  });
});
