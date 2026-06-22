import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runStrategicStage } from '../../../src/services/rd/strategic-stage.js';
import { runTacticalStage } from '../../../src/services/rd/tactical-stage.js';

describe('rd sub-stages end-to-end', () => {
  it('strategic → tactical → sig chain', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-rd-e2e-'));
    try {
      mkdirSync(join(workdir, 'src'), { recursive: true });
      writeFileSync(join(workdir, 'src', 'A.ts'), 'export const add = (a: number, b: number) => a + b;\n');
      const strat = await runStrategicStage({
        out: join(workdir, 'strategy.md'),
        goal: 'add add helper',
        rootCauseAnalysis: 'no local add helper',
        impactSurface: ['src/A.ts'],
        designRationale: 'trivial',
      });
      const tact = await runTacticalStage({
        project: workdir, changedFiles: ['src/A.ts'],
        inputSig: strat.sha256, context: { deps: {}, docSummaries: [] },
        out: join(workdir, 'impl.json'),
      });
      expect(tact.inputSig).toBe(strat.sha256);
      expect(existsSync(join(workdir, 'strategy.md'))).toBe(true);
      expect(existsSync(join(workdir, 'impl.json'))).toBe(true);
      expect(readFileSync(join(workdir, 'strategy.md'), 'utf8')).toContain(strat.sha256);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
