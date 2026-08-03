import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runAudit } from '~/src/services/capability-audit-service/runner';
import type { LlmRunner } from '~/src/services/final-review/index';

const stubRunner: LlmRunner = {
  call: async () => ({ output: JSON.stringify({ verdict: 'consistent' }), tokens: { input: 1, output: 1 } })
};

let proj = '';
afterEach(() => { if (proj) rmSync(proj, { recursive: true, force: true }); proj = ''; });

describe('runAudit (independent-eval stub)', () => {
  it('returns verdict=consistent when guard and independent agree', async () => {
    proj = mkdtempSync(join(tmpdir(), 'cbl-aud-'));
    const r = await runAudit({ projectRoot: proj, sessionId: 'a', journeyId: 'J01', llmRunner: stubRunner, guardSummary: { pass: 1, fail: 0, skipped: 0, total: 1, results: [] } });
    expect(r.verdict).toBe('consistent');
  });
});
