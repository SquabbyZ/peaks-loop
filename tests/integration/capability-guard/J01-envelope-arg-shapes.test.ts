import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getGuardContract } from '~/src/services/capability-guard-runner/registry';
import { runGuard } from '~/src/services/capability-guard-runner/runner';

const REPO = resolve(__dirname, '..', '..', '..');
const JOURNEY = 'J01' as const;

// Runs through the production path (registry -> runGuard), so the baseline-ref
// assertion and the real contract body are both exercised. The previous shape
// called the contract directly with `contract: {}`, which skipped the registry.
describe('J01 envelope-arg-shapes contract', () => {
  it('routes every fixture case through the super-command surface', async () => {
    const contract = getGuardContract(JOURNEY)!;
    const r = await runGuard(contract, {
      projectRoot: REPO,
      sessionId: JOURNEY,
      contract,
      baselineInvariant: 'auto'
    });
    expect(r.status).toBe('pass');
  }, 300_000);

  // Falsification control: with the implementation under test removed, the
  // contract MUST go red. `PEAKS_BIN_OVERRIDE` points the probe at a CLI that
  // does not exist, which is the cheapest stand-in for "the implementation was
  // deleted". Without this case a contract that can only ever report `pass`
  // would look identical.
  it('reports a diff when the routed CLI is unavailable', async () => {
    const contract = getGuardContract(JOURNEY)!;
    process.env.PEAKS_BIN_OVERRIDE = 'peaks-bin-that-does-not-exist';
    try {
      const r = await runGuard(contract, {
        projectRoot: REPO,
        sessionId: JOURNEY,
        contract,
        baselineInvariant: 'auto'
      });
      expect(r.status).toBe('fail');
      expect(r.diff?.reason).toMatch(/J01 invariant broken/);
    } finally {
      delete process.env.PEAKS_BIN_OVERRIDE;
    }
  }, 300_000);
});
