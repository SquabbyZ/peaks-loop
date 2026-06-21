/**
 * Per spec §4.1 — Collector is the first CLI-enforced step. All reads
 * happen via Node fs (not via LLM "please read" prompts).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectContext } from '../../../../src/services/context/collector.js';

let workdir: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  workdir = mkdtempSync(join(tmpdir(), 'peaks-context-collector-'));
  process.chdir(workdir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(workdir, { recursive: true, force: true });
});

function makeRepo(): void {
  mkdirSync('src/pages/Login', { recursive: true });
  writeFileSync('src/pages/Login/LoginForm.tsx', 'export const X = 1;\n');
  writeFileSync('package.json', JSON.stringify({
    name: 'demo',
    dependencies: { antd: '5.21.0', react: '18.3.1' },
  }, null, 2));
  writeFileSync('pnpm-lock.yaml', 'lockfileVersion: 9\n');
}

describe('collectContext', () => {
  it('scans files and parses locked deps from package.json', async () => {
    makeRepo();
    const result = await collectContext({
      goal: 'add OAuth callback',
      project: workdir,
      depsMode: 'locked',
    });
    expect(result.collector.files).toContainEqual(
      expect.objectContaining({ path: 'src/pages/Login/LoginForm.tsx', kind: 'source' })
    );
    expect(result.collector.deps['antd']).toMatchObject({ version: '5.21.0' });
    expect(result.collector.deps['react']).toMatchObject({ version: '18.3.1' });
  });

  it('throws when package.json is missing', async () => {
    expect(() => collectContext({
      goal: 'x',
      project: workdir,
      depsMode: 'locked',
    })).rejects.toThrow(/no package.json/i);
  });

  it('hard-fails when locked version is absent (no --deps-mode latest escape)', async () => {
    writeFileSync('package.json', JSON.stringify({ name: 'demo', dependencies: {} }, null, 2));
    await expect(collectContext({
      goal: 'x',
      project: workdir,
      depsMode: 'locked',
    })).rejects.toThrow(/locked version/i);
  });

  it('excludes the `out` file from the file sweep when out is inside project', async () => {
    makeRepo();
    const outPath = join(workdir, 'ctx.json');
    writeFileSync(outPath, '{"placeholder": true}\n');
    const result = await collectContext({
      goal: 'x',
      project: workdir,
      depsMode: 'locked',
      out: outPath,
    });
    const filePaths = result.collector.files.map((f) => f.path);
    expect(filePaths).not.toContain('ctx.json');
    // sanity: real source file is still present
    expect(filePaths).toContain('src/pages/Login/LoginForm.tsx');
  });
});
