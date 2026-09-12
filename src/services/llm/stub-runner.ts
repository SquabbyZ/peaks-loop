/**
 * Offline `LlmRunner` behind `peaks audit goal --llm-provider stub`.
 *
 * It exists so CI and unit tests can exercise the CLI route — including
 * `auditGoal()`'s 6-dimension validation — without a network call. It
 * performs NO audit: every finding below is a placeholder, which is why
 * the CLI reports this run as `scaffold-only` / `providerBinding: 'stub'`
 * and never as an audit.
 */

import type { LlmRunner } from '../audit/audit-goal-service.js';

const NOT_AUDITED = 'Stub provider: this placeholder is not an audit finding.';

const STUB_REPLY = JSON.stringify({
  summary: 'Stub provider: no audit was performed.',
  audit: [
    { dimension: 'correctness', finding: NOT_AUDITED, severity: 'info' },
    { dimension: 'completeness', finding: NOT_AUDITED, severity: 'info' },
    { dimension: 'scope', finding: NOT_AUDITED, severity: 'info' },
    { dimension: 'risks', finding: NOT_AUDITED, severity: 'info' },
    { dimension: 'alternatives', finding: NOT_AUDITED, severity: 'info' },
    { dimension: 'constraints', finding: NOT_AUDITED, severity: 'info' }
  ],
  proposedGoal: 'Stub provider: no goal proposed.',
  successCriteria: ['Stub provider: no acceptance criteria produced.'],
  roughEffort: 'small',
  confidence: 'low',
  rationale: 'Stub provider: the six dimensions above are placeholders so the CLI route can be exercised without a network call. Treating this as an audit would defeat the gate.'
});

export function createStubRunner(): LlmRunner {
  return {
    async call() {
      return { output: STUB_REPLY, tokens: { input: 0, output: 0 } };
    }
  };
}
