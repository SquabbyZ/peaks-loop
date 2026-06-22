import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTacticalStage } from '../../../../src/services/rd/tactical-stage.js';

describe('runTacticalStage', () => {
  it('runs AST gate then writes TACT.sig when gate passes', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-tactstage-'));
    try {
      mkdirSync(join(workdir, 'src'), { recursive: true });
      writeFileSync(join(workdir, 'src', 'A.ts'), `
        import { add } from './local';
        export const x = add(1, 2);
      `);
      const out = join(workdir, 'impl.json');
      const result = await runTacticalStage({
        project: workdir,
        changedFiles: ['src/A.ts'],
        inputSig: 'a'.repeat(64),
        context: { deps: {}, docSummaries: [] },
        out,
      });
      expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(existsSync(out)).toBe(true);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it('throws when AST gate fails — does NOT write TACT.sig', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-tactstage-fail-'));
    try {
      mkdirSync(join(workdir, 'src'), { recursive: true });
      writeFileSync(join(workdir, 'src', 'A.ts'), `
        import { unknownApi } from 'oauth-client';
        unknownApi();
      `);
      await expect(runTacticalStage({
        project: workdir,
        changedFiles: ['src/A.ts'],
        inputSig: 'a'.repeat(64),
        context: {
          deps: { 'oauth-client': { version: '2.4.0', source: 'package.json', resolved: '' } },
          docSummaries: [{ dep: 'oauth-client', version: '2.4.0', apis: ['handleCallback'] }],
        },
        out: join(workdir, 'impl.json'),
      })).rejects.toThrow(/AST gate/);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
