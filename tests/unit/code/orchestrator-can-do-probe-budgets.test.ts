import { describe, expect, it } from 'vitest';
import {
  CONTEXT_RATIO_PROBE_TIMEOUT_MS,
  SUB_AGENT_PROBE_TIMEOUT_MS
} from '~/src/services/code/orchestrator-can-do-probes';

// The two budgets are read from the module that owns the execFile calls, so the
// comparison below is over the values the probes actually run with.
describe('Scenario: probe budgets — Q2 must not be the tighter budget', () => {
  it('when comparing the two probe budgets, should keep the Q2 budget at least as large as the Q4 budget', () => {
    // given: both probe budgets, read from the module that runs the execFile calls
    const q2Budget = SUB_AGENT_PROBE_TIMEOUT_MS;
    const q4Budget = CONTEXT_RATIO_PROBE_TIMEOUT_MS;
    // when: the two budgets are compared
    // then: Q2 must not be the tighter one; the message names the constant that
    //       was lowered below Q4 (the macOS run showed 10 s enough for Q4 while
    //       a 5 s Q2 was killed at 5035 ms)
    expect(
      q2Budget >= q4Budget,
      `SUB_AGENT_PROBE_TIMEOUT_MS (${q2Budget} ms) was lowered below ` +
        `CONTEXT_RATIO_PROBE_TIMEOUT_MS (${q4Budget} ms); Q2 needs the larger budget`
    ).toBe(true);
  });
});
