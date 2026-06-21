import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { createContextCommands } from '../../../../src/cli/commands/context-builder-commands.js';

let workdir: string;
let outdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'peaks-cli-ctx-'));
  outdir = mkdtempSync(join(tmpdir(), 'peaks-cli-ctx-out-'));
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

describe('peaks context commands', () => {
  it('build writes context.json via CLI', async () => {
    // Pre-flight fix: createContextCommands returns a NAMED Command('context').
    // Wrap it in an unnamed root and drop the script-name 'peaks' from argv —
    // commander 12 strips argv[0..1] unconditionally, so userArgs starts at
    // argv[2]. With an unnamed root, argv[2] must be 'context' (the first
    // subcommand), not 'peaks'.
    const ctx = createContextCommands({
      fetcher: async (dep: string, version: string) => {
        if (dep === 'antd' && version === '5.21.0') {
          return { version: '5.21.0', excerpt: 'Form.Item' };
        }
        return null;
      },
    });
    const program = new Command().addCommand(ctx);
    await program.parseAsync([
      'node', 'peaks', 'context', 'build',
      '--goal', 'add OAuth',
      '--project', workdir,
      '--audience', 'peaks-rd',
      '--deps-mode', 'locked',
      '--doc-budget-tokens', '8000',
      '--out', join(outdir, 'context.json'),
    ]);
    expect(existsSync(join(outdir, 'context.json'))).toBe(true);
    const json = JSON.parse(readFileSync(join(outdir, 'context.json'), 'utf8'));
    expect(json.version).toBe('1.0');
    expect(json.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('validate accepts a valid context.json', async () => {
    // First, build one.
    const ctx = createContextCommands({ fetcher: async () => null });
    const program = new Command().addCommand(ctx);
    const out = join(outdir, 'context.json');
    await program.parseAsync([
      'node', 'peaks', 'context', 'build',
      '--goal', 'x', '--project', workdir, '--audience', 'all',
      '--deps-mode', 'locked', '--doc-budget-tokens', '8000', '--out', out,
    ]);
    // Reset program state for second invocation.
    const ctx2 = createContextCommands({ fetcher: async () => null });
    const program2 = new Command().addCommand(ctx2);
    const exitCode = await new Promise<number>((resolve) => {
      program2.exitOverride().parseAsync([
        'node', 'peaks', 'context', 'validate', out,
      ]).then(() => resolve(0)).catch((err) => resolve(err.code ?? 1));
    });
    expect(exitCode).toBe(0);
  });
});