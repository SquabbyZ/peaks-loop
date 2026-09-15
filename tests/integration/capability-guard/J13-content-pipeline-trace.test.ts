import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getGuardContract } from '~/src/services/capability-guard-runner/registry';
import { runGuard } from '~/src/services/capability-guard-runner/runner';

const REPO = resolve(__dirname, '..', '..', '..');
const JOURNEY = 'J13' as const;

// Runs through the production path (registry -> runGuard), so the baseline-ref
// assertion and the real contract body are both exercised. The previous shape
// called the contract directly with `contract: {}`, which skipped the registry.
describe('J13 content-pipeline-trace contract', () => {
  it('keeps the four content stages and the peaks-code boundary', async () => {
    const contract = getGuardContract(JOURNEY)!;
    const r = await runGuard(contract, { projectRoot: REPO, sessionId: JOURNEY, contract, baselineInvariant: 'auto' });
    expect(r.status).toBe('pass');
  }, 300_000);
});
