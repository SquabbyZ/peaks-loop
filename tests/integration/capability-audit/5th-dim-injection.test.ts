import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runAudit } from '~/src/services/capability-audit-service/runner';
import type { LlmRunner } from '~/src/services/final-review/index';

const stubRunner: LlmRunner = {
  call: async () => ({ output: JSON.stringify({ verdict: 'drifted' }), tokens: { input: 1, output: 1 } })
};

let proj = '';
afterEach(() => { if (proj) rmSync(proj, { recursive: true, force: true }); proj = ''; });

describe('5th-dim injection', () => {
  it('a drifted audit forces the 5th dim to fail', async () => {
    proj = mkdtempSync(join(tmpdir(), 'cbl-inj-'));
    const audit = await runAudit({ projectRoot: proj, sessionId: 'i', journeyId: 'J01', llmRunner: stubRunner, guardSummary: { pass: 0, fail: 1, skipped: 0, total: 1, results: [] } });
    expect(audit.verdict).toBe('drifted');
  });
});