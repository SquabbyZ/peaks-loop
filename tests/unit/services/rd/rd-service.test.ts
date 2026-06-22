import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runStrategic, runTactical } from '../../../../src/services/rd/rd-service.js';

describe('rd-service sub-stage exports (Plan 3)', () => {
  it('runStrategic + runTactical produce STRAT.sig → TACT.sig chain via re-exports', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-rd-service-'));
    try {
      mkdirSync(join(workdir, 'src'), { recursive: true });
      writeFileSync(join(workdir, 'src', 'A.ts'), `import { add } from './local';\nexport const x = add(1, 2);\n`);

      const strat = await runStrategic({
        out: join(workdir, 'strategy.md'),
        goal: 'add OAuth',
        rootCauseAnalysis: 'callback URL unknown',
        impactSurface: ['LoginForm.tsx'],
        designRationale: 'option B',
      });
      expect(strat.sha256).toMatch(/^[a-f0-9]{64}$/);

      const tact = await runTactical({
        project: workdir,
        changedFiles: ['src/A.ts'],
        inputSig: strat.sha256,
        context: { deps: {}, docSummaries: [] },
        out: join(workdir, 'impl.json'),
      });
      expect(tact.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(tact.inputSig).toBe(strat.sha256);
      // STRAT.sig in strategy.md must match what tactical received
      const stratContent = readFileSync(join(workdir, 'strategy.md'), 'utf8');
      expect(stratContent).toContain(`STRAT.sig: ${strat.sha256}`);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
