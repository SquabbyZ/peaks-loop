import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeStrategy } from '../../../../src/services/rd/strategy.js';

describe('writeStrategy', () => {
  it('writes strategy.md + computes STRAT.sig from content (excluding sig field)', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-strategy-'));
    try {
      const out = await writeStrategy({
        out: join(workdir, 'strategy.md'),
        goal: 'add OAuth',
        rootCauseAnalysis: 'callback URL unknown',
        impactSurface: ['LoginForm.tsx'],
        designRationale: 'option B',
      });
      expect(out.sha256).toMatch(/^[a-f0-9]{64}$/);
      const onDisk = readFileSync(join(workdir, 'strategy.md'), 'utf8');
      expect(onDisk).toContain('add OAuth');
      expect(onDisk).toContain('STRAT.sig:');
      expect(onDisk).toContain(out.sha256);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
