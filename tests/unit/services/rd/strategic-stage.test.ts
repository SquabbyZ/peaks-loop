import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runStrategicStage } from '../../../../src/services/rd/strategic-stage.js';

describe('runStrategicStage', () => {
  it('produces strategy.md + STRAT.sig atomically', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-stratstage-'));
    try {
      const out = join(workdir, 'strategy.md');
      const result = await runStrategicStage({
        goal: 'add OAuth',
        rootCauseAnalysis: 'callback URL unknown',
        impactSurface: ['LoginForm.tsx'],
        designRationale: 'option B',
        out,
      });
      expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(existsSync(out)).toBe(true);
      expect(readFileSync(out, 'utf8')).toContain('STRAT.sig');
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
