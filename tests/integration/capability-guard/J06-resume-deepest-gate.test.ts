import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getGuardContract } from '~/src/services/capability-guard-runner/registry';
import { runGuard } from '~/src/services/capability-guard-runner/runner';

const REPO = resolve(__dirname, '..', '..', '..');
const JOURNEY = 'J06' as const;

// Runs through the production path (registry -> runGuard), so the baseline-ref
// assertion and the real contract body are both exercised. The previous shape
// called the contract directly with `contract: {}`, which skipped the registry.
describe('J06 resume-deepest-gate contract', () => {
  it('identifies the deepest completed gate', async () => {
    const contract = getGuardContract(JOURNEY)!;
    const r = await runGuard(contract, { projectRoot: REPO, sessionId: JOURNEY, contract, baselineInvariant: 'auto' });
    expect(r.status).toBe('pass');
  }, 300_000);
});
