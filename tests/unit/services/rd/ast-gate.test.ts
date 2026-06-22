import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAstGate } from '../../../../src/services/rd/ast-gate.js';

let workdir: string;
beforeEach(() => { workdir = mkdtempSync(join(tmpdir(), 'peaks-astgate-')); });
afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

describe('runAstGate (★ load-bearing)', () => {
  it('passes when external API call uses the locked version', async () => {
    mkdirSync(join(workdir, 'src'), { recursive: true });
    writeFileSync(join(workdir, 'src', 'oauth.ts'), `
      import { handleCallback } from 'oauth-client';
      handleCallback({ code: 'x' });
    `);
    const result = await runAstGate({
      project: workdir,
      changedFiles: ['src/oauth.ts'],
      context: {
        deps: { 'oauth-client': { version: '2.4.0', source: 'package.json', resolved: '' } },
        docSummaries: [
          { dep: 'oauth-client', version: '2.4.0', apis: ['handleCallback', 'init'] },
        ],
      },
    });
    expect(result.passed).toBe(true);
  });

  it('FAILS when external API call uses a non-locked version (★ core gate)', async () => {
    mkdirSync(join(workdir, 'src'), { recursive: true });
    writeFileSync(join(workdir, 'src', 'oauth.ts'), `
      import { handleCallbackV3 } from 'oauth-client';
      handleCallbackV3({ code: 'x' });
    `);
    const result = await runAstGate({
      project: workdir,
      changedFiles: ['src/oauth.ts'],
      context: {
        deps: { 'oauth-client': { version: '2.4.0', source: 'package.json', resolved: '' } },
        docSummaries: [
          { dep: 'oauth-client', version: '2.4.0', apis: ['handleCallback', 'init'] },
        ],
      },
    });
    expect(result.passed).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations[0]).toMatchObject({
      api: 'handleCallbackV3',
      expectedVersion: '2.4.0',
    });
  });

  it('passes when no external API calls (pure local code)', async () => {
    mkdirSync(join(workdir, 'src'), { recursive: true });
    writeFileSync(join(workdir, 'src', 'util.ts'), `
      export const add = (a: number, b: number) => a + b;
    `);
    const result = await runAstGate({
      project: workdir,
      changedFiles: ['src/util.ts'],
      context: { deps: {}, docSummaries: [] },
    });
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });
});
