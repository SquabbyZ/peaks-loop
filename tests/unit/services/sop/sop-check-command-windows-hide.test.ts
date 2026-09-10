import { describe, it, expect, vi, beforeEach } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn()
}));

import { execFileSync } from 'node:child_process';
import { evaluateGate } from '../../../../src/services/sop/sop-check-service';
import type { SopGate } from '../../../../src/services/sop/sop-types';

declareDimensions(
  'tests/unit/services/sop/sop-check-command-windows-hide.test.ts',
  ['behavior'],
  [
    { dim: 'render', reason: 'returns a structured verdict, no text / JSON surface' },
    {
      dim: 'integration',
      reason:
        'the child-process boundary is mocked on purpose — launching a real child is exactly what pops the console window this gate must suppress'
    },
    { dim: 'a11y', reason: 'no user-visible text or exit code' }
  ]
);

const COMMAND_GATE: SopGate = {
  id: 'has-node',
  phase: 'publish',
  check: { type: 'command', run: ['node', '--version'] }
};

describe('behavior — SOP command-gate spawn options', () => {
  beforeEach(() => vi.clearAllMocks());

  it('when a command gate is evaluated, should hide the child console window', () => {
    // given: a command gate on the enforced path (`peaks gate enforce`
    //        always evaluates with allowCommands: true)
    // when: the gate is evaluated
    const verdict = evaluateGate('.', COMMAND_GATE, { allowCommands: true });
    // then: the spawn suppresses the Windows console window, and the
    //       existing stdio / timeout contract is unchanged
    expect(verdict.result).toBe('pass');
    expect(execFileSync).toHaveBeenCalledTimes(1);
    expect(execFileSync).toHaveBeenCalledWith(
      'node',
      ['--version'],
      expect.objectContaining({ stdio: 'ignore', timeout: 30_000, windowsHide: true })
    );
  });
});
