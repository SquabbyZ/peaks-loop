import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getGuardContract } from '~/src/services/capability-guard-runner/registry';
import { runGuard } from '~/src/services/capability-guard-runner/runner';

const REPO = resolve(__dirname, '..', '..', '..');
const JOURNEY = 'J02' as const;

describe('J02 workflow-trace contract', () => {
  it('refuses an incomplete jump to handed-off and walks the RD state machine', async () => {
    const contract = getGuardContract(JOURNEY)!;
    const r = await runGuard(contract, {
      projectRoot: REPO,
      sessionId: JOURNEY,
      contract,
      baselineInvariant: 'auto'
    });
    expect(r.status).toBe('pass');
  }, 300_000);
});
