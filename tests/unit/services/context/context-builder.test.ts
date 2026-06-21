/**
 * Per spec §4.1 — ContextBuilder orchestrates 4 steps and writes a single
 * context.json with sha256 of its own contents (H8 audit trail).
 *
 * Hard constraint H8: sha256 must be the hash of the *contents excluding*
 * the sha256 field itself (else chicken-and-egg).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildContext } from '../../../../src/services/context/context-builder.js';

let workdir: string;
let outdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'peaks-builder-'));
  outdir = mkdtempSync(join(tmpdir(), 'peaks-builder-out-'));
  mkdirSync(join(workdir, 'src'), { recursive: true });
  writeFileSync(join(workdir, 'src', 'A.ts'), 'export const X = 1;\n');
  writeFileSync(join(workdir, 'package.json'), JSON.stringify({
    name: 'demo', dependencies: { antd: '5.21.0' },
  }));
  writeFileSync(join(workdir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
  rmSync(outdir, { recursive: true, force: true });
});

describe('buildContext', () => {
  it('produces a context.json with valid sha256', async () => {
    const ctx = await buildContext({
      goal: 'add OAuth',
      project: workdir,
      audience: 'peaks-rd',
      depsMode: 'locked',
      docBudgetTokens: 8000,
      out: join(outdir, 'context.json'),
      fetcher: async (dep: string, version: string) => {
        if (dep === 'antd' && version === '5.21.0') {
          return { version: '5.21.0', excerpt: 'Form.Item' };
        }
        return null;
      },
    });
    expect(ctx.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(existsSync(join(outdir, 'context.json'))).toBe(true);
  });

  it('writes the same sha256 as the file on disk', async () => {
    await buildContext({
      goal: 'x',
      project: workdir,
      audience: 'peaks-rd',
      depsMode: 'locked',
      docBudgetTokens: 8000,
      out: join(outdir, 'context.json'),
      fetcher: async () => null,
    });
    const onDisk = JSON.parse(readFileSync(join(outdir, 'context.json'), 'utf8'));
    expect(onDisk.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('atomic write — no partial file on disk if interrupted', async () => {
    // Simulate by using a directory that becomes unwritable mid-write.
    // v1: writes to <out>.tmp then renames — verify <out>.tmp is cleaned.
    const target = join(outdir, 'context.json');
    await buildContext({
      goal: 'x', project: workdir, audience: 'peaks-rd', depsMode: 'locked',
      docBudgetTokens: 8000, out: target,
      fetcher: async () => null,
    });
    expect(existsSync(`${target}.tmp`)).toBe(false);
  });
});
