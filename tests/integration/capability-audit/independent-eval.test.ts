import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runAudit } from '~/src/services/capability-audit-service/runner';
import type { LlmRunner } from '~/src/services/final-review/index';

const consistentRunner: LlmRunner = {
  call: async () => ({ output: JSON.stringify({ verdict: 'consistent' }), tokens: { input: 1, output: 1 } })
};

let proj = '';
afterEach(() => { if (proj) rmSync(proj, { recursive: true, force: true }); proj = ''; });

describe('runAudit (independent eval)', () => {
  it('never reports consistent when the scorer is a stub', async () => {
    proj = mkdtempSync(join(tmpdir(), 'cbl-aud-'));
    const r = await runAudit({ projectRoot: proj, sessionId: 'a', journeyId: 'J01', scorerMode: 'stub', llmRunner: consistentRunner, guardSummary: { pass: 1, fail: 0, skipped: 0, total: 1, results: [] } });
    // The stub's own `{"verdict":"consistent"}` is a restatement of the stub,
    // not evidence about the product — it must not be able to release.
    expect(r.verdict).toBe('inconclusive');
    expect(r.degraded).toBe(true);
    expect(r.requiresUserDecision).toBe(true);
  });

  it('returns verdict=consistent when a live scorer and the guard agree', async () => {
    proj = mkdtempSync(join(tmpdir(), 'cbl-aud-'));
    const r = await runAudit({ projectRoot: proj, sessionId: 'a', journeyId: 'J01', scorerMode: 'live', llmRunner: consistentRunner, guardSummary: { pass: 1, fail: 0, skipped: 0, total: 1, results: [] } });
    expect(r.verdict).toBe('consistent');
    expect(r.degraded).toBe(false);
  });

  it('scores one dimension per guard result', async () => {
    proj = mkdtempSync(join(tmpdir(), 'cbl-aud-'));
    const r = await runAudit({
      projectRoot: proj,
      sessionId: 'a',
      journeyId: 'J01',
      scorerMode: 'live',
      llmRunner: consistentRunner,
      guardSummary: {
        pass: 1,
        fail: 1,
        skipped: 0,
        total: 2,
        results: [
          { journeyId: 'J01', contract: 'envelope-arg-shapes', status: 'pass', artifactPath: 'a' },
          { journeyId: 'J02', contract: 'workflow-trace', status: 'fail', diff: { before: 'x', after: 'y', reason: 'z' }, artifactPath: 'b' }
        ]
      }
    });
    expect(r.dimensions.map((d) => [d.journeyId, d.consistencyScore])).toEqual([['J01', 1], ['J02', 0]]);
  });
});
