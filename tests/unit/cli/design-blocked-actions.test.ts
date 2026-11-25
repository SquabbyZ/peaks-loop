import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { CHECK_BLOCKED_ACTIONS } from '../../../src/services/design/acceptance.js';

declareDimensions(
  'tests/unit/cli/design-blocked-actions.test.ts',
  ['behavior', 'a11y'],
  [
    { dim: 'render', reason: 'the record is data; no envelope or stdout is rendered here' },
    {
      dim: 'integration',
      reason: 'a pure module lookup: no fs, network, process or clock boundary'
    }
  ]
);

describe('Scenario: a11y — every blocked check code names a next action', () => {
  it('when a G2 code blocks, should offer a non-empty next action list', () => {
    // given: every code the S1 and G2 matrices can block with
    // when: each is looked up in the shared next-action record
    // then: none is left with an empty list for the user to stare at
    const codes = [
      'DESIGN_ENGINE_UNAVAILABLE',
      'DESIGN_ENGINE_VERSION_UNSUPPORTED',
      'DESIGN_BROWSER_UNAVAILABLE',
      'DESIGN_RENDER_URL_MISSING',
      'DESIGN_URL_UNTRUSTED',
      'DESIGN_RENDER_UNREACHABLE',
      'DESIGN_RENDER_NO_EVIDENCE',
      'DESIGN_ROUTE_MISMATCH',
      'DESIGN_START_COMMAND_MISSING',
      'DESIGN_START_COMMAND_EXITED',
      'DESIGN_START_NOT_ALLOWED',
      'DESIGN_SESSION_ID_INVALID',
      'DESIGN_CONTRACT_INVALID',
      'DESIGN_RENDER_REQUIRED',
      'DESIGN_BASELINE_INVALID',
      'DESIGN_FIDELITY_MIN_INVALID',
      'DESIGN_FIDELITY_URL_UNREACHABLE',
      'DESIGN_FIDELITY_NO_EVIDENCE',
      'DESIGN_FIDELITY_SELF_COMPARE',
      'DESIGN_RUBRIC_MISSING',
      'DESIGN_RUBRIC_INVALID'
    ];
    for (const code of codes) {
      expect(CHECK_BLOCKED_ACTIONS[code]?.length, code).toBeGreaterThan(0);
    }
  });
});
